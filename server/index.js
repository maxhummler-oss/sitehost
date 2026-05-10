const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const AdmZip = require('adm-zip');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const db = require('./db');
const nginx = require('./nginx');

const PORT = parseInt(process.env.PORT || '6767', 10);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: false, // wir liefern eigene Inline-Assets
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Sessions regelmäßig aufräumen
setInterval(() => db.cleanupSessions(), 1000 * 60 * 60).unref();

// ----- Helpers -----

function getCurrentUser(req) {
  const token = req.cookies?.sh_session;
  const session = db.getSession(token);
  if (!session) return null;
  return db.getUserById(session.user_id);
}

function requireAuth(req, res, next) {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Nicht angemeldet' });
  req.user = user;
  next();
}

function setSessionCookie(res, token, expiresAt) {
  res.cookie('sh_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // hinter Reverse-Proxy mit TLS auf true setzen
    expires: new Date(expiresAt),
    path: '/',
  });
}

function isValidSlug(s) {
  return typeof s === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(s);
}

function isValidDomain(s) {
  if (typeof s !== 'string') return false;
  if (s.length > 253) return false;
  return /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(s);
}

function safeJoin(root, target) {
  const resolved = path.resolve(root, target);
  if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) {
    return null;
  }
  return resolved;
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

// ----- Auth Routes -----

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/api/status', (req, res) => {
  res.json({
    setupRequired: !db.hasUsers(),
    authenticated: !!getCurrentUser(req),
  });
});

app.post('/api/setup', authLimiter, async (req, res) => {
  if (db.hasUsers()) {
    return res.status(403).json({ error: 'Setup wurde bereits abgeschlossen' });
  }
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || username.length < 3 || username.length > 32) {
    return res.status(400).json({ error: 'Benutzername muss 3-32 Zeichen haben' });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(400).json({ error: 'Benutzername darf nur a-z, 0-9, _ und - enthalten' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben' });
  }
  const hash = await bcrypt.hash(password, 12);
  const userId = db.createUser(username, hash);
  const { token, expiresAt } = db.createSession(userId);
  setSessionCookie(res, token, expiresAt);
  res.json({ ok: true });
});

app.post('/api/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Ungültige Eingabe' });
  }
  const user = db.getUserByUsername(username);
  if (!user) {
    // gleicher Zeitaufwand
    await bcrypt.compare(password, '$2a$12$abcdefghijklmnopqrstuv');
    return res.status(401).json({ error: 'Falscher Benutzername oder Passwort' });
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Falscher Benutzername oder Passwort' });
  const { token, expiresAt } = db.createSession(user.id);
  setSessionCookie(res, token, expiresAt);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies?.sh_session;
  if (token) db.deleteSession(token);
  res.clearCookie('sh_session', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username } });
});

// ----- Sites API -----

app.get('/api/sites', requireAuth, (req, res) => {
  const sites = db.listSites(req.user.id).map((s) => ({
    ...s,
    proxy_enabled: !!s.proxy_enabled,
    file_count: countFiles(nginx.siteRoot(s.id)),
  }));
  res.json({ sites });
});

app.post('/api/sites', requireAuth, (req, res) => {
  const { name, slug } = req.body || {};
  if (typeof name !== 'string' || name.length < 1 || name.length > 64) {
    return res.status(400).json({ error: 'Name muss 1-64 Zeichen haben' });
  }
  if (!isValidSlug(slug)) {
    return res.status(400).json({
      error: 'Slug ungültig (a-z, 0-9, -, 1-40 Zeichen, beginnt/endet alphanumerisch)',
    });
  }
  if (db.getSiteBySlug(slug)) {
    return res.status(409).json({ error: 'Slug ist bereits vergeben' });
  }
  const id = db.createSite(req.user.id, name, slug);
  fs.mkdirSync(nginx.siteRoot(id), { recursive: true });
  // Platzhalter index.html
  fs.writeFileSync(
    path.join(nginx.siteRoot(id), 'index.html'),
    `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
<style>body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b0b0c;color:#f4f1ea}
.box{text-align:center;max-width:560px;padding:2rem}
h1{font-size:2rem;margin:0 0 .5rem}p{opacity:.7}</style></head>
<body><div class="box"><h1>${escapeHtml(name)}</h1>
<p>Site erfolgreich angelegt. Lade Dateien über das Admin-Panel hoch.</p></div></body></html>`
  );
  const site = db.getSite(id, req.user.id);
  res.json({ site: { ...site, proxy_enabled: !!site.proxy_enabled } });
});

app.get('/api/sites/:id', requireAuth, (req, res) => {
  const site = db.getSite(req.params.id, req.user.id);
  if (!site) return res.status(404).json({ error: 'Site nicht gefunden' });
  res.json({ site: { ...site, proxy_enabled: !!site.proxy_enabled } });
});

app.patch('/api/sites/:id', requireAuth, async (req, res) => {
  const site = db.getSite(req.params.id, req.user.id);
  if (!site) return res.status(404).json({ error: 'Site nicht gefunden' });

  const updates = {};
  if ('name' in (req.body || {})) {
    if (typeof req.body.name !== 'string' || req.body.name.length < 1 || req.body.name.length > 64) {
      return res.status(400).json({ error: 'Name ungültig' });
    }
    updates.name = req.body.name;
  }
  if ('custom_domain' in (req.body || {})) {
    const cd = req.body.custom_domain;
    if (cd === null || cd === '') {
      updates.custom_domain = null;
    } else {
      if (!isValidDomain(cd)) return res.status(400).json({ error: 'Ungültige Domain' });
      updates.custom_domain = cd.toLowerCase();
    }
  }
  if ('proxy_enabled' in (req.body || {})) {
    updates.proxy_enabled = req.body.proxy_enabled ? 1 : 0;
  }

  // Wenn Proxy aktiviert, muss Domain gesetzt sein
  const finalDomain = 'custom_domain' in updates ? updates.custom_domain : site.custom_domain;
  const finalProxy = 'proxy_enabled' in updates ? updates.proxy_enabled : site.proxy_enabled;
  if (finalProxy && !finalDomain) {
    return res.status(400).json({ error: 'Reverse-Proxy benötigt eine Domain' });
  }

  try {
    db.updateSite(site.id, req.user.id, updates);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Domain wird bereits verwendet' });
    }
    throw e;
  }

  const updated = db.getSite(site.id, req.user.id);
  const result = await nginx.syncSite(updated);
  res.json({
    site: { ...updated, proxy_enabled: !!updated.proxy_enabled },
    nginx: result,
  });
});

app.delete('/api/sites/:id', requireAuth, async (req, res) => {
  const site = db.getSite(req.params.id, req.user.id);
  if (!site) return res.status(404).json({ error: 'Site nicht gefunden' });
  db.deleteSite(site.id, req.user.id);
  rmrf(nginx.siteRoot(site.id));
  nginx.removeVhostFile(site.id);
  await nginx.reloadNginx();
  res.json({ ok: true });
});

// ----- File-Operationen -----

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

function listTree(dir, base = '') {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push({ path: rel, type: 'dir' });
      out.push(...listTree(full, rel));
    } else {
      const stat = fs.statSync(full);
      out.push({ path: rel, type: 'file', size: stat.size });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

app.get('/api/sites/:id/files', requireAuth, (req, res) => {
  const site = db.getSite(req.params.id, req.user.id);
  if (!site) return res.status(404).json({ error: 'Site nicht gefunden' });
  res.json({ files: listTree(nginx.siteRoot(site.id)) });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 200 },
});

// Erlaubt unbekannte Felder, damit Browser-Uploads von Verzeichnissen funktionieren
const uploadAny = upload.any();

app.post('/api/sites/:id/upload', requireAuth, (req, res) => {
  const site = db.getSite(req.params.id, req.user.id);
  if (!site) return res.status(404).json({ error: 'Site nicht gefunden' });

  uploadAny(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Keine Dateien empfangen' });
    }

    const root = nginx.siteRoot(site.id);
    fs.mkdirSync(root, { recursive: true });

    const replace = req.body?.replace === '1' || req.body?.replace === 'true';
    if (replace) {
      // alles in root löschen aber Verzeichnis behalten
      for (const f of fs.readdirSync(root)) rmrf(path.join(root, f));
    }

    let written = 0;
    let zipExpanded = 0;

    for (const f of req.files) {
      // Pfad bestimmen: zuerst webkitRelativePath via originalname (multer setzt nur originalname),
      // ansonsten der Dateiname
      const rel = (f.originalname || '').replace(/\\/g, '/');
      if (!rel) continue;

      // ZIP automatisch entpacken
      if (rel.toLowerCase().endsWith('.zip') && req.files.length === 1) {
        try {
          const zip = new AdmZip(f.buffer);
          for (const entry of zip.getEntries()) {
            if (entry.isDirectory) continue;
            const entryName = entry.entryName.replace(/\\/g, '/');
            // Zip-Slip verhindern
            if (entryName.includes('..') || entryName.startsWith('/')) continue;
            const dest = safeJoin(root, entryName);
            if (!dest) continue;
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, entry.getData());
            zipExpanded++;
          }
        } catch (e) {
          return res.status(400).json({ error: 'ZIP konnte nicht gelesen werden: ' + e.message });
        }
        continue;
      }

      // Pfad-Traversal verhindern
      if (rel.includes('..') || rel.startsWith('/')) continue;
      const dest = safeJoin(root, rel);
      if (!dest) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.buffer);
      written++;
    }

    db.touchSite(site.id);
    res.json({ ok: true, written, zipExpanded });
  });
});

app.delete('/api/sites/:id/files', requireAuth, (req, res) => {
  const site = db.getSite(req.params.id, req.user.id);
  if (!site) return res.status(404).json({ error: 'Site nicht gefunden' });
  const target = req.query.path;
  if (typeof target !== 'string' || target.length === 0) {
    return res.status(400).json({ error: 'Pfad fehlt' });
  }
  const dest = safeJoin(nginx.siteRoot(site.id), target);
  if (!dest || !fs.existsSync(dest)) {
    return res.status(404).json({ error: 'Datei nicht gefunden' });
  }
  rmrf(dest);
  db.touchSite(site.id);
  res.json({ ok: true });
});

// ----- Site Preview (lokales Hosting auf Admin-Port unter /preview/<slug>/) -----

app.use('/preview/:slug', (req, res, next) => {
  const site = db.getSiteBySlug(req.params.slug);
  if (!site) return res.status(404).send('Site nicht gefunden');
  const root = nginx.siteRoot(site.id);
  const sub = req.path === '/' ? '/index.html' : req.path;
  const target = safeJoin(root, sub.replace(/^\//, ''));
  if (!target) return res.status(400).send('Bad path');
  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    return res.sendFile(target);
  }
  // Fallback index.html für SPA
  const fallback = path.join(root, 'index.html');
  if (fs.existsSync(fallback)) return res.sendFile(fallback);
  res.status(404).send('Datei nicht gefunden');
});

// ----- Static Frontend -----

app.use(express.static(PUBLIC_DIR));

app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// ----- Boot -----

(async () => {
  await nginx.regenerateAllVhosts();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[sitehost] Admin-Panel auf Port ${PORT}`);
  });
})();
