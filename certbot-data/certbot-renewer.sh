#!/bin/sh
echo "Certbot DNS-Cloudflare: Starting certificate management for $DOMAIN"

# First, try to obtain/renew certificate initially
echo "$(date): Initial certificate check/generation for $DOMAIN..."
certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    --non-interactive \
    --expand \
    --domains $DOMAIN \
    --cert-name $DOMAIN

echo "Initial certificate process completed"
echo "Starting auto-renewal loop - checking every 12 hours"

while :; do
    echo "$(date): Checking certificate renewal for $DOMAIN..."
    
    if certbot renew \
        --dns-cloudflare \
        --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
        --quiet \
        --no-random-sleep-on-renew \
        --deploy-hook "echo Certificate renewed, reloading nginx..."; then
        echo "$(date): Certificate check completed successfully"
        docker kill -s HUP videocutter-nginx-lb 2>/dev/null || echo "Nginx container not found or already reloaded"
    else
        echo "$(date): Certificate renewal check failed or not needed"
    fi
    
    echo "$(date): Sleeping for 12 hours..."
    sleep 43200
done
