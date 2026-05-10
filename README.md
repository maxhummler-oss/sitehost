# sitehost

Selbst-gehosteter Multi-Site-Host für statische Webseiten — wie ein kleines, lokales Netlify. Läuft komplett in einem Docker-Container.

## Was du bekommst

- **Admin-Weboberfläche** auf Port `6767` mit dunklem, editorialem Look
- **Sicherer Login** mit bcrypt-gehashten Passwörtern und httpOnly-Session-Cookies
- **Erstes Setup** beim ersten Aufruf — du legst dort deinen Admin-Account an
- **Multi-Site** — beliebig viele statische Webseiten parallel hosten
- **Datei-Upload** über Drag-and-Drop, ganze Ordner oder als ZIP (wird automatisch entpackt)
- **Live-Preview** auf `http://<host>:6767/preview/<slug>/`
- **Reverse-Proxy via nginx** — pro Site eigene Domain freischalten, vhost wird automatisch generiert und nginx neu geladen
- **Persistenter Storage** im Docker-Volume `/data`

## Schnellstart

```bash
# Repository ablegen, dann:
docker compose up -d --build
```

Anschließend:

1. Browser öffnen: `http://<host>:6767`
2. Beim ersten Start: Admin-Account anlegen
3. Site anlegen → Dateien hochladen → fertig

## Ports

| Port | Zweck |
|------|-------|
| `6767` | Admin-Panel + Preview der Sites |
| `80` | Nginx, der die freigegebenen Sites unter ihren Domains ausliefert |

Wenn du Port 80 nicht nach außen brauchst, lass die Zeile in `docker-compose.yml` einfach weg.

## Eigene Domain auf eine Site routen

1. DNS-A-Record deiner Domain (z.B. `meinedomain.de`) auf die IP der Maschine zeigen lassen.
2. Im Admin-Panel die Site öffnen → unter **Eigene Domain** den Domain-Namen eintragen.
3. **Reverse Proxy** aktivieren → speichern.

Sitehost generiert daraufhin in `/data/nginx-sites/<id>.conf` einen vhost und macht ein `nginx -s reload`. Die Site ist sofort unter ihrer Domain auf Port 80 erreichbar.

> **HTTPS**: Für TLS empfehlen wir, den Container hinter einen Reverse-Proxy (Caddy / Traefik) zu stellen, der die Zertifikate verwaltet und auf Port 80/6767 weiterleitet. Innerhalb des Containers läuft kein certbot.

## Datenpersistenz

Alles Wichtige liegt im Volume `/data`:

```
/data/
├── db.sqlite           # User & Sites
├── sites/<id>/...      # die hochgeladenen Dateien jeder Site
└── nginx-sites/*.conf  # generierte vhosts
```

Backup = das Volume sichern.

## Sicherheitshinweise

- Stelle sicher, dass Port `6767` nur über einen TLS-Reverse-Proxy oder über VPN erreichbar ist, da der Login dort sonst im Klartext läuft.
- Setze in `server/index.js` das Cookie auf `secure: true`, sobald TLS davor liegt.
- Rate-Limiting für Login/Setup ist eingebaut (30 Versuche / 15 Min).

## Updates

```bash
git pull   # oder neue Quellen einspielen
docker compose up -d --build
```

Das Volume bleibt erhalten, alle Sites und User auch.

## Lokale Entwicklung ohne Docker

```bash
npm install
DATA_DIR=./data PORT=6767 npm start
```

Nginx-Reload schlägt dann lokal fehl (kein nginx installiert) — die Reverse-Proxy-Funktion testest du am besten im Container.
