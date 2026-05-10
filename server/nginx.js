const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { DATA_DIR, getAllProxiedSites } = require('./db');

const NGINX_SITES_DIR = path.join(DATA_DIR, 'nginx-sites');
const SITES_ROOT = path.join(DATA_DIR, 'sites');
fs.mkdirSync(NGINX_SITES_DIR, { recursive: true });
fs.mkdirSync(SITES_ROOT, { recursive: true });

function siteRoot(siteId) {
  return path.join(SITES_ROOT, siteId);
}

function vhostPath(siteId) {
  return path.join(NGINX_SITES_DIR, `${siteId}.conf`);
}

function escapeServerName(name) {
  // Validierung: nur erlaubte Zeichen für Domain
  return /^[a-zA-Z0-9.-]+$/.test(name) ? name : null;
}

function buildVhostConfig(site) {
  const safeName = escapeServerName(site.custom_domain);
  if (!safeName) return null;
  const root = siteRoot(site.id);
  return `# Auto-generiert für Site ${site.id} (${site.name})
server {
    listen 80;
    listen [::]:80;
    server_name ${safeName};

    root ${root};
    index index.html index.htm;

    # Sicherheits-Header
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Verzeichnis-Listing aus, kein dotfile-Zugriff
    location ~ /\\. {
        deny all;
    }

    location / {
        try_files $uri $uri/ $uri.html /index.html =404;
    }

    # Caching für Assets
    location ~* \\.(?:css|js|jpg|jpeg|png|gif|ico|svg|woff2?|ttf|eot)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    error_page 404 /404.html;
    error_page 500 502 503 504 /50x.html;
}
`;
}

function writeVhostFile(site) {
  const conf = buildVhostConfig(site);
  if (!conf) return false;
  fs.writeFileSync(vhostPath(site.id), conf, 'utf8');
  return true;
}

function removeVhostFile(siteId) {
  const p = vhostPath(siteId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function reloadNginx() {
  return new Promise((resolve) => {
    // nginx -t prüfen, dann reload
    execFile('nginx', ['-t'], (err, stdout, stderr) => {
      if (err) {
        console.error('[nginx] Test fehlgeschlagen:', stderr);
        resolve({ ok: false, error: stderr || err.message });
        return;
      }
      execFile('nginx', ['-s', 'reload'], (err2, _o, stderr2) => {
        if (err2) {
          console.error('[nginx] Reload fehlgeschlagen:', stderr2);
          resolve({ ok: false, error: stderr2 || err2.message });
          return;
        }
        resolve({ ok: true });
      });
    });
  });
}

async function syncSite(site) {
  if (site.proxy_enabled && site.custom_domain) {
    if (!writeVhostFile(site)) {
      return { ok: false, error: 'Ungültiger Domain-Name' };
    }
  } else {
    removeVhostFile(site.id);
  }
  return await reloadNginx();
}

async function regenerateAllVhosts() {
  // Alle vorhandenen entfernen, dann neu schreiben
  for (const f of fs.readdirSync(NGINX_SITES_DIR)) {
    if (f.endsWith('.conf')) fs.unlinkSync(path.join(NGINX_SITES_DIR, f));
  }
  for (const site of getAllProxiedSites()) {
    writeVhostFile(site);
  }
  return await reloadNginx();
}

module.exports = {
  SITES_ROOT,
  NGINX_SITES_DIR,
  siteRoot,
  syncSite,
  removeVhostFile,
  reloadNginx,
  regenerateAllVhosts,
};
