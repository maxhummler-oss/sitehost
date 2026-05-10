# =====================================================================
# sitehost — self-hosted static site host
# Admin-UI auf Port 6767, gehostete Sites über nginx auf Port 80
# =====================================================================

FROM node:20-bookworm-slim

# Nginx + Build-Tools für native Module
RUN apt-get update && apt-get install -y --no-install-recommends \
        nginx \
        ca-certificates \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*

# Standard nginx-Configs entfernen, eigene reinkopieren
RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf 2>/dev/null || true

WORKDIR /app

# Dependencies zuerst (Cache)
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Build-Tools wieder entfernen, nachdem better-sqlite3 kompiliert ist
RUN apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Anwendung
COPY server ./server
COPY public ./public
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY scripts/start.sh /start.sh
RUN chmod +x /start.sh

# Daten-Volume
VOLUME ["/data"]

ENV NODE_ENV=production
ENV PORT=6767
ENV DATA_DIR=/data

EXPOSE 6767
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:6767/api/status',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["/start.sh"]
