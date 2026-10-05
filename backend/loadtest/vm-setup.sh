#!/usr/bin/env bash
# Prepare a fresh Ubuntu VM to generate load against the payment engine,
# with each connection slowed down to match real users' networks.
#
#   scp -r loadtest root@<vm>:~/ && ssh root@<vm> 'bash ~/loadtest/vm-setup.sh'
#
# Tunables (env):
#   TARGET_HOST  host being tested                          (api.2settle.io)
#   DELAY        added one-way delay -> adds this to RTT    (600ms)
#   JITTER       +/- variation on DELAY                     (400ms)
#   LOSS         packet loss                                (0%)
# Defaults approximate what we measured from a user-like connection:
# 0.4-1.5s round trips, very uneven. Calibrate from real users if you can.
#
# Only traffic to TARGET_HOST is slowed, so your SSH session stays usable.
# Remove the shaping with:  tc qdisc del dev <iface> root
set -euo pipefail

TARGET_HOST="${TARGET_HOST:-api.2settle.io}"
DELAY="${DELAY:-600ms}"
JITTER="${JITTER:-400ms}"
LOSS="${LOSS:-0%}"

echo "==> Installing k6"
if ! command -v k6 >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq gnupg ca-certificates curl iproute2
  curl -fsSL https://dl.k6.io/key.gpg | gpg --dearmor -o /usr/share/keyrings/k6-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
    > /etc/apt/sources.list.d/k6.list
  apt-get update -qq
  apt-get install -y -qq k6
fi
k6 version

echo "==> Raising OS limits for thousands of open connections"
cat > /etc/sysctl.d/99-k6.conf <<'EOF'
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.core.somaxconn = 65535
fs.file-max = 1000000
EOF
sysctl -q --system
cat > /etc/security/limits.d/99-k6.conf <<'EOF'
* soft nofile 250000
* hard nofile 250000
root soft nofile 250000
root hard nofile 250000
EOF

echo "==> Slowing traffic to ${TARGET_HOST}: delay ${DELAY} ± ${JITTER}, loss ${LOSS}"
IFACE="$(ip route get 1.1.1.1 | awk '{for (i = 1; i <= NF; i++) if ($i == "dev") print $(i + 1)}')"
TARGET_IP="$(getent ahostsv4 "$TARGET_HOST" | awk 'NR == 1 {print $1}')"
tc qdisc del dev "$IFACE" root 2>/dev/null || true
tc qdisc add dev "$IFACE" root handle 1: prio
tc qdisc add dev "$IFACE" parent 1:3 handle 30: netem delay "$DELAY" "$JITTER" distribution normal loss "$LOSS"
tc filter add dev "$IFACE" protocol ip parent 1:0 prio 3 u32 match ip dst "${TARGET_IP}/32" flowid 1:3

echo "==> Check: round trips to ${TARGET_IP} should now be slow and uneven"
for _ in 1 2 3 4 5; do
  curl -s -o /dev/null -w "connect=%{time_connect}s tls=%{time_appconnect}s total=%{time_total}s\n" \
    "https://${TARGET_HOST}/v1/health"
done

cat <<EOF

Ready. Whitelist this VM's IP in mod_evasive: $(curl -s https://api.ipify.org)

Then, in a new shell (so the file limit applies):
  ulimit -n 250000
  cd ~ && k6 run -e PROFILE=ramp -e BASE_URL=https://${TARGET_HOST} \\
    -e API_KEY=pk_test_... -e SECRET_KEY=sk_test_... loadtest/payment-engine.js
EOF
