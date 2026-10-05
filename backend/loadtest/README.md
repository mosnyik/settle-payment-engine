# Load testing (k6)

Goal: find where the deployed stack (`Apache → Docker → Express → MySQL`) breaks on the way to 5k concurrent sessions.

## 1. Server prep (do this first, or you're only testing the rate limiters)

A single k6 machine is one IP. Three layers will throttle it within seconds:

| Layer | Limit | What to do for the test window |
|---|---|---|
| Apache `mod_evasive` | 50 req / 2s per IP, then a 60s block | Add `DOSWhitelist <k6-machine-ip>` to `/etc/apache2/conf.d/300-mod_evasive.conf`, reload httpd. **Remove it afterwards.** |
| Express `rateLimit` (public routes, keyed by IP) | 100 req/min (standard tier) | `RATE_LIMIT_ENABLED=false` in the container env, restart. **Turn it back on afterwards.** |
| Express `rateLimit` (per API key) | 10,000 req/min even on `unlimited` | Covered by the same flag. |

Also:

- Create a **sandbox** key (the script refuses live keys) with no IP whitelist:
  ```
  POST /v1/admin/api-keys
  { "merchantId": "k6-loadtest", "name": "k6", "rateLimitTier": "unlimited", "isSandbox": true }
  ```
- Run off-peak. This hits the production DB and Apache that real users share.
- Don't run k6 on the VPS itself — it will fight the app for CPU and the results will be wrong.

## 2. Run

```bash
# install: winget install k6   (or choco install k6)
cd backend
export BASE_URL=https://api.2settle.io API_KEY=pk_test_... SECRET_KEY=sk_test_...

k6 run -e PROFILE=smoke  -e BASE_URL=$BASE_URL -e API_KEY=$API_KEY -e SECRET_KEY=$SECRET_KEY loadtest/payment-engine.js
k6 run -e PROFILE=ramp   ...   # steps 250 → 500 → 1k → 2k → 3.5k → 5k, ~22 min
k6 run -e PROFILE=hold5k ...   # 5k VUs for 10 min
k6 run -e PROFILE=spike  ...   # 0 → 5k in 30s
```

Always run `smoke` first and confirm 0 failures. Then `ramp` — it's the one that answers "how many concurrent sessions can we reliably handle". It holds each level in `LEVELS` for `HOLD_TIME`, judges each level against the SLO on its own, and ends with a table like:

```
Capacity by concurrent sessions (SLO: p95 < 3000ms, errors < 1.0%)
 sessions  p95 total  p95 wait  errors     reqs  result
      250     1650ms    1100ms   0.00%    41200  PASS
      500     1720ms    1150ms   0.00%    82900  PASS
     1000     4100ms    3600ms   0.40%   151000  FAIL

Reliable capacity: 500 concurrent sessions
```

`p95 total` includes the network; `p95 wait` is time-to-first-byte (server time plus about one round trip). If `total` rises while `wait` stays flat, the extra time is going into connecting, not the server. `ramp`/`hold5k`/`spike` abort if the overall error rate stays above 10% for a minute, to stop hammering production once it's clearly past capacity.

## 2b. Where to run k6 from

Not from a laptop on a home or office link. 5k connections through one router and one uplink measure that link, not the server. Real users each have their own (slow) connection.

Use a cloud VM (Ubuntu, ~8 vCPU / 16 GB for 5k VUs, same region as the VPS) and slow its traffic down to match your users' networks:

```bash
scp -r loadtest root@<vm>:~/
ssh root@<vm> 'bash ~/loadtest/vm-setup.sh'                # default: +600ms ±400ms per round trip
ssh root@<vm> 'DELAY=800ms JITTER=500ms LOSS=1% bash ~/loadtest/vm-setup.sh'   # harsher mobile network
```

Slow clients hold each connection (and Apache worker) longer, so this matters for capacity, not just for latency. Whitelist the VM's IP (the script prints it) in mod_evasive, not your laptop's. Destroy the VM afterwards.

Options (`-e NAME=value`):

| Var | Default | Meaning |
|---|---|---|
| `WRITE_RATIO` | `0.1` | Share of sessions that create a payment |
| `SEED_REFS` | `20` | Payments created in setup for read-only sessions to poll |
| `MAX_DERIVATIONS` | `0` | Enables a separate scenario creating payments that derive real HD addresses |
| `LEVELS` | `250,500,1000,2000,3500,5000` | Concurrent sessions the `ramp` profile steps through |
| `RAMP_TIME` / `HOLD_TIME` | `1m` / `3m` | Time to reach each level / time held at it (only the hold is measured) |
| `SLO_P95_MS` | `3000` | p95 latency (network included) a level must stay under to count as reliable |
| `SLO_ERROR_RATE` | `0.01` | Error rate a level must stay under |

A session is: `GET /rate` + `GET /banks/list` → think → maybe `POST /payments` → poll `GET /payments/:ref` ×3 (3s apart) → think. At 5k VUs that's roughly 700–900 req/s.

Results are written to `loadtest/results/<profile>-<timestamp>.json`.

### About `MAX_DERIVATIONS`

The default write path creates `request` payments without crypto, which don't derive an address. Sandbox payments with crypto **do** derive real addresses from the production seed, and every one advances `hd_wallet_config.next_index` permanently. A large run of unused addresses pushes real deposits past the ~20-address gap limit that wallet software (Electrum, Trust, etc.) uses when recovering from the seed. The engine tracks its own indexes so sweeping still works, but a manual recovery from the seed phrase would miss funds. Keep this small (e.g. `MAX_DERIVATIONS=50`) — it's there to measure the lock, not to generate volume.

## 3. Watch the server while it runs

Watch the VPS during the run. The k6 output tells you *that* latency went up; the server tells you *why*.

```bash
docker stats payment-engine                      # CPU pinned at 100% on one core = Node event loop is the limit
docker logs -f payment-engine 2>&1 | grep -iE "error|timeout|ETIMEDOUT|ECONNRESET|Too many"
mysql -e "SHOW PROCESSLIST;" | wc -l             # connections in use (pool max is 50)
mysql -e "SHOW GLOBAL STATUS LIKE 'Threads_running';"
mysql -e "SHOW ENGINE INNODB STATUS\G" | grep -A5 "LOCK WAIT"
apachectl fullstatus | head -30                  # busy vs idle workers
tail -f /var/log/apache2/error_log | grep -i "MaxRequestWorkers"
ss -s                                            # open TCP connections
```

## 4. Suspected bottlenecks (from reading the code) — what to confirm

Ordered by how early I expect each to show up:

1. **Apache worker limit.** Each VU holds a keep-alive connection. With the default `MaxRequestWorkers` (150–400 depending on MPM), 5k connections can't all be served — requests queue at Apache and the Express side looks idle. Sign: `server reached MaxRequestWorkers` in `error_log`, fast `http_req_connecting`/`http_req_waiting` climbing while `docker stats` CPU stays low.
2. **MySQL pool of 50** (`src/lib/mysql.ts`, `queueLimit: 0`). Every request does several DB round trips: an `audit_logs` INSERT per request (`auditLog` middleware), and on authenticated routes also `SELECT api_keys` + `UPDATE last_used_at`. The pool queues without limit, so there's no error, only rising latency. Sign: `SHOW PROCESSLIST` pinned near 50, p95 climbing on every endpoint equally, including cheap ones like `/rate`.
3. **15s `connect-timeout`** (`src/index.ts`). When the pool queue gets deep, requests start returning 503. Sign: `server_timeouts_503` counter > 0.
4. **HD derivation lock** (`SELECT ... FOR UPDATE` on `hd_wallet_config`, `hd-wallet.service.ts:121`). All address-deriving creates run one at a time per chain. Only visible with `MAX_DERIVATIONS` set: `payment_create_derive` p95 grows with the derive scenario's VU count.
5. **Single Node process.** No clustering, so all HMAC/JSON work runs on one core. Sign: container CPU ~100% of one core while MySQL is idle.

When you have a ramp result, the stage where p95 stops levelling off is your current capacity. Fix the first bottleneck you find and rerun — the next one usually only shows up after the first is gone.
