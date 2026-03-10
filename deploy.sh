#!/bin/bash
# =============================================================================
# Payment Engine - Deployment Script
# =============================================================================
# Usage:
#   First time:  ./deploy.sh setup
#   Deploy:      ./deploy.sh deploy
#   SSL:         ./deploy.sh ssl yourdomain.com
#   Logs:        ./deploy.sh logs
#   Status:      ./deploy.sh status
# =============================================================================

set -e

COMPOSE_FILE="docker-compose.yml"
COMPOSE_PROD="docker-compose.prod.yml"

case "$1" in
  setup)
    echo "=== Setting up Payment Engine ==="

    # Create .env if not exists
    if [ ! -f .env ]; then
      cp .env.example .env
      echo "Created .env file - EDIT IT WITH YOUR VALUES!"
      exit 1
    fi

    # Create nginx directories
    mkdir -p nginx/ssl nginx/certbot

    # Build and start
    docker compose -f $COMPOSE_FILE up -d --build

    echo "=== Setup complete! ==="
    echo "API running at http://localhost:3500"
    ;;

  deploy)
    echo "=== Deploying Payment Engine ==="

    # Pull latest changes
    git pull origin main

    # Rebuild and restart
    docker compose -f $COMPOSE_FILE -f $COMPOSE_PROD up -d --build

    echo "=== Deployment complete! ==="
    ;;

  ssl)
    DOMAIN=$2
    if [ -z "$DOMAIN" ]; then
      echo "Usage: ./deploy.sh ssl yourdomain.com"
      exit 1
    fi

    echo "=== Setting up SSL for $DOMAIN ==="

    # Get certificate
    docker compose -f $COMPOSE_FILE -f $COMPOSE_PROD run --rm certbot \
      certonly --webroot --webroot-path=/var/www/certbot \
      --email admin@$DOMAIN --agree-tos --no-eff-email \
      -d $DOMAIN

    # Update nginx config
    sed -i "s/yourdomain.com/$DOMAIN/g" nginx/nginx.conf

    # Reload nginx
    docker compose -f $COMPOSE_FILE -f $COMPOSE_PROD exec nginx nginx -s reload

    echo "=== SSL setup complete for $DOMAIN ==="
    ;;

  logs)
    docker compose -f $COMPOSE_FILE logs -f payment-engine
    ;;

  status)
    docker compose -f $COMPOSE_FILE ps
    ;;

  stop)
    docker compose -f $COMPOSE_FILE -f $COMPOSE_PROD down
    ;;

  restart)
    docker compose -f $COMPOSE_FILE -f $COMPOSE_PROD restart payment-engine
    ;;

  *)
    echo "Usage: ./deploy.sh {setup|deploy|ssl|logs|status|stop|restart}"
    exit 1
    ;;
esac
