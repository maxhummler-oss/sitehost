#!/bin/sh
set -e

# Sicherstellen dass die Daten-Verzeichnisse existieren
mkdir -p /data/sites /data/nginx-sites
mkdir -p /var/log/nginx /var/lib/nginx /run/nginx
chown -R www-data:www-data /data /var/log/nginx /var/lib/nginx /run/nginx 2>/dev/null || true

# Nginx im Vordergrund unter eigenem Prozess starten, dann nach hinten
echo "[boot] starte nginx…"
nginx -t
nginx

# Node-Server im Vordergrund (PID 1 fängt Signale)
echo "[boot] starte sitehost auf Port ${PORT:-6767}…"
exec node /app/server/index.js
