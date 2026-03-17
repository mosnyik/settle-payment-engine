# Payment Engine - Docker Deployment Guide

This guide covers deploying the Payment Engine to a VPS using Docker.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Files Overview](#files-overview)
- [VPS Initial Setup](#vps-initial-setup)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [SSL Setup](#ssl-setup)
- [Common Commands](#common-commands)
- [Updating Your App](#updating-your-app)
- [Troubleshooting](#troubleshooting)
- [Backup & Restore](#backup--restore)

---

## Prerequisites

- A **VPS or dedicated server** plan — Docker does not work on shared hosting
  - Bluehost VPS runs **AlmaLinux 9** (uses `yum`/`dnf`, not `apt`)
  - DigitalOcean, AWS, Hetzner etc. typically run Ubuntu (uses `apt`)
- A domain name pointed to your VPS IP
- Terminal access via SSH **or** Bluehost's integrated cPanel Terminal

---

## Files Overview

| File | Description |
|------|-------------|
| `Dockerfile` | Multi-stage build for the Node.js app |
| `docker-compose.yml` | Main compose file (app + MySQL) |
| `docker-compose.prod.yml` | Production overrides (Nginx + SSL) |
| `nginx/nginx.conf` | Reverse proxy configuration |
| `deploy.sh` | Deployment helper script |
| `.dockerignore` | Files excluded from Docker build |

---

## VPS Initial Setup

### 1. Connect to your VPS

**Option A — SSH (recommended)**

```bash
ssh root@your-vps-ip
```

**Option B — Bluehost Integrated Terminal (no SSH client needed)**

1. Log in to your Bluehost account at [bluehost.com](https://www.bluehost.com)
2. Go to **Hosting** → select your hosting plan
3. Open **cPanel** (button in the top right or sidebar)
4. Scroll to the **Advanced** section and click **Terminal**
5. A browser-based terminal opens — you are already logged in as your hosting user

> **Requirements:** Docker deployment requires a **VPS or dedicated server** plan — it does **not** work on Bluehost shared hosting. Shared hosting restricts system-level access and cannot run Docker.
>
> **OS note:** Bluehost VPS runs **CentOS/AlmaLinux**, not Ubuntu. Replace all `apt` commands in this guide with `yum` (or `dnf`):
> ```bash
> # Instead of: apt update && apt upgrade -y
> sudo yum update -y
>
> # Instead of: apt install docker-compose-plugin -y
> sudo yum install docker-compose-plugin -y
> ```
>
> The terminal runs as your cPanel user, not `root`. Use `sudo` for privileged commands, or `sudo -i` to open a root shell.

### 2. Update system packages

**Ubuntu/Debian:**
```bash
apt update && apt upgrade -y
```

**AlmaLinux/CentOS (Bluehost VPS):**
```bash
yum update -y
```

### 3. Install Docker

**Ubuntu/Debian:**
```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
```

**AlmaLinux/CentOS (Bluehost VPS):**

> Avoid piping `curl` to `sh` on AlmaLinux — the subshell PATH may not include `/bin`, causing `systemctl` to fail mid-install. Use the package manager instead:

```bash
yum install -y yum-utils
yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker

# Verify
docker --version
docker compose version
```

### 4. Install Docker Compose

**Ubuntu/Debian:**
```bash
apt install docker-compose-plugin -y
docker compose version
```

**AlmaLinux/CentOS (Bluehost VPS):** Already installed via `docker-compose-plugin` in step 3 — skip this step.

### 5. Clone your repository

```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/your-username/payment-engine.git
cd payment-engine
```

### 6. Create required directories

```bash
mkdir -p nginx/ssl nginx/certbot
```

---

## Configuration

### 1. Create environment file

```bash
cp .env.example .env
nano .env
```

### 2. Required environment variables

```env
# =============================================================================
# DATABASE
# =============================================================================
DB_PASSWORD=your_secure_password_here
DB_NAME=2settle
DB_USER=root

# =============================================================================
# ADMIN
# =============================================================================
ADMIN_SECRET=your_secure_admin_secret_here

# =============================================================================
# EXTERNAL APIs
# =============================================================================
COINMARKETCAP_API_KEY=your_key
NUBAN_API_KEY=your_key
ETHERSCAN_API_KEY=your_key
BSCSCAN_API_KEY=your_key
TRONGRID_API_KEY=your_key

# =============================================================================
# HD WALLET
# =============================================================================
HD_WALLET_ENABLED=true
HD_SEED_PHRASE_ENCRYPTED=your_encrypted_seed
HD_SEED_ENCRYPTION_KEY=your_64_char_hex_key
HOT_WALLET_BITCOIN=bc1q...
HOT_WALLET_ETHEREUM=0x...
HOT_WALLET_TRON=T...

# =============================================================================
# SWEEPER
# =============================================================================
SWEEPER_ENABLED=true
ETHEREUM_RPC_URL=https://eth.llamarpc.com
BSC_RPC_URL=https://bsc-dataseed.binance.org

# =============================================================================
# WATCHER
# =============================================================================
WATCHER_ENABLED=true

# =============================================================================
# SETTLEMENT
# =============================================================================
SETTLEMENT_ENABLED=true
MONGORO_API_URL=https://api-biz.mongoro.com/api/v1/openapi
MONGORO_TOKEN=your_token
MONGORO_TRANSFERPIN=your_pin
MONGORO_CALLBACK_URL=https://api.yourdomain.com/v1/webhooks/mongoro

# =============================================================================
# TELEGRAM ALERTS
# =============================================================================
TELEGRAM_ALERTS_ENABLED=true
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### 3. Update Nginx config with your domain

```bash
nano nginx/nginx.conf
```

Replace `yourdomain.com` with your actual domain (e.g., `api.sirfi.com`).

---

## Deployment

### Development/Testing (No SSL)

```bash
# Build and start containers
docker compose up -d --build

# Check status
docker compose ps

# View logs
docker compose logs -f payment-engine

# Test health endpoint
curl http://localhost:3500/v1/health
```

### Production (With Nginx)

```bash
# Start with production config
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Check all services
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

---

## SSL Setup

### 1. Ensure your domain points to your VPS

```bash
# Check DNS resolution
dig api.yourdomain.com
```

### 2. Get SSL certificate from Let's Encrypt

```bash
# First, start nginx without SSL to handle the ACME challenge
# Temporarily comment out SSL lines in nginx.conf, then:

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d nginx

# Request certificate
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm certbot \
  certonly --webroot --webroot-path=/var/www/certbot \
  --email admin@yourdomain.com --agree-tos --no-eff-email \
  -d api.yourdomain.com
```

### 3. Update Nginx config

```bash
nano nginx/nginx.conf
```

Update the SSL certificate paths:

```nginx
ssl_certificate /etc/nginx/ssl/live/api.yourdomain.com/fullchain.pem;
ssl_certificate_key /etc/nginx/ssl/live/api.yourdomain.com/privkey.pem;
```

### 4. Restart Nginx

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart nginx
```

### 5. Verify SSL

```bash
curl https://api.yourdomain.com/v1/health
```

---

## Common Commands

### Container Management

| Task | Command |
|------|---------|
| Start all services | `docker compose up -d` |
| Stop all services | `docker compose down` |
| Restart a service | `docker compose restart payment-engine` |
| View running containers | `docker compose ps` |
| View all logs | `docker compose logs -f` |
| View app logs only | `docker compose logs -f payment-engine` |

### Debugging

| Task | Command |
|------|---------|
| Shell into app container | `docker compose exec payment-engine sh` |
| Shell into MySQL | `docker compose exec mysql mysql -u root -p` |
| Check container health | `docker inspect payment-engine --format='{{.State.Health.Status}}'` |
| View resource usage | `docker stats` |

### Database

| Task | Command |
|------|---------|
| Access MySQL CLI | `docker compose exec mysql mysql -u root -p 2settle` |
| Run migrations | `docker compose exec mysql mysql -u root -p 2settle < migrations/001_create_tables.sql` |
| Export database | `docker compose exec mysql mysqldump -u root -p 2settle > backup.sql` |
| Import database | `docker compose exec -T mysql mysql -u root -p 2settle < backup.sql` |

---

## Updating Your App

### Standard Update

```bash
cd /var/www/payment-engine

# Pull latest code
git pull origin main

# Rebuild and restart
docker compose up -d --build

# Verify
docker compose logs -f payment-engine
```

### Zero-Downtime Update (Advanced)

```bash
# Build new image without stopping current
docker compose build payment-engine

# Restart with new image (brief downtime)
docker compose up -d --no-deps payment-engine
```

---

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs payment-engine

# Check if port is in use
netstat -tlnp | grep 3500

# Rebuild from scratch
docker compose down
docker compose up -d --build --force-recreate
```

### Database connection issues

```bash
# Check if MySQL is running
docker compose ps mysql

# Test connection from app container
docker compose exec payment-engine sh -c "nc -zv mysql 3306"

# Check MySQL logs
docker compose logs mysql
```

### SSL certificate issues

```bash
# Check certificate expiry
docker compose exec nginx openssl x509 -in /etc/nginx/ssl/live/yourdomain.com/fullchain.pem -noout -dates

# Force certificate renewal
docker compose run --rm certbot renew --force-renewal

# Reload nginx after renewal
docker compose exec nginx nginx -s reload
```

### Out of disk space

```bash
# Check disk usage
df -h

# Clean up Docker
docker system prune -a --volumes
```

---

## Backup & Restore

### Backup Database

```bash
# Create backup
docker compose exec mysql mysqldump -u root -p"$DB_PASSWORD" 2settle > backup_$(date +%Y%m%d).sql

# Compress
gzip backup_$(date +%Y%m%d).sql
```

### Restore Database

```bash
# Decompress
gunzip backup_20240115.sql.gz

# Restore
docker compose exec -T mysql mysql -u root -p"$DB_PASSWORD" 2settle < backup_20240115.sql
```

### Backup Environment

```bash
# Backup .env (store securely!)
cp .env .env.backup
```

### Automated Backups (Cron)

```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * cd /var/www/payment-engine && docker compose exec -T mysql mysqldump -u root -p"PASSWORD" 2settle | gzip > /var/backups/payment-engine/backup_$(date +\%Y\%m\%d).sql.gz
```

---

## Security Checklist

- [ ] Strong `DB_PASSWORD` (20+ characters)
- [ ] Strong `ADMIN_SECRET` (32+ characters)
- [ ] SSL enabled and working
- [ ] Firewall configured (only ports 80, 443, 22 open)
- [ ] Regular backups configured
- [ ] `.env` file not in git
- [ ] SSH key authentication (disable password auth)

---

## Support

For issues or questions:
- Check logs: `docker compose logs -f`
- GitHub Issues: https://github.com/your-repo/payment-engine/issues
