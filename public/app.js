// ================================================================
// sitehost — frontend SPA
// ================================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  user: null,
  setupRequired: false,
  sites: [],
};

// ---------- API Helper ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function apiUpload(path, formData) {
  const res = await fetch(path, { method: 'POST', body: formData, credentials: 'include' });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// ---------- Toast ----------
function toast(msg, type = 'info') {
  let stack = $('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  stack.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity 0.2s';
    setTimeout(() => t.remove(), 200);
  }, 3500);
}

// ---------- Router ----------
function navigate(hash) {
  if (location.hash !== hash) location.hash = hash;
  else render();
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  try {
    const status = await api('/api/status');
    state.setupRequired = status.setupRequired;
    if (status.authenticated) {
      const me = await api('/api/me');
      state.user = me.user;
    }
  } catch (e) {
    console.error(e);
  }
  render();
}

async function render() {
  const root = $('#app');
  root.innerHTML = '';
  const hash = location.hash || '#/';

  if (state.setupRequired) return renderSetup(root);
  if (!state.user) {
    if (hash !== '#/login') return navigate('#/login');
    return renderLogin(root);
  }

  // Authenticated routes
  if (hash === '#/login') return navigate('#/sites');
  const shell = mountShell(root);

  const m = hash.match(/^#\/sites\/([a-zA-Z0-9]+)$/);
  if (m) return renderSiteDetail(shell, m[1]);
  return renderSitesList(shell);
}

// ---------- Shell ----------
function mountShell(root) {
  const tpl = $('#tpl-shell').content.cloneNode(true);
  root.appendChild(tpl);
  $('[data-user]').textContent = state.user.username;
  $('[data-logout]').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    state.user = null;
    navigate('#/login');
  });
  return $('[data-content]');
}

// ---------- Setup ----------
function renderSetup(root) {
  root.innerHTML = `
    <div class="auth-stage">
      <div class="auth-card">
        <div class="auth-eyebrow">Erste Einrichtung</div>
        <h1 class="auth-title">Lege deinen <em>Admin-Account</em> an</h1>
        <p class="auth-subtitle">Diese Instanz ist noch nicht eingerichtet. Wähle einen Benutzernamen und ein sicheres Passwort.</p>
        <form id="setup-form">
          <div class="field">
            <label>Benutzername</label>
            <input class="input" type="text" name="username" autocomplete="username" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_-]+">
          </div>
          <div class="field">
            <label>Passwort</label>
            <input class="input" type="password" name="password" autocomplete="new-password" required minlength="8">
            <span class="hint">Mindestens 8 Zeichen</span>
          </div>
          <div class="field">
            <label>Passwort wiederholen</label>
            <input class="input" type="password" name="password2" autocomplete="new-password" required minlength="8">
          </div>
          <div id="setup-error" class="error-text" style="display:none"></div>
          <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">Account erstellen</button>
        </form>
      </div>
    </div>
  `;
  $('#setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const username = fd.get('username');
    const password = fd.get('password');
    const password2 = fd.get('password2');
    const errEl = $('#setup-error');
    errEl.style.display = 'none';
    if (password !== password2) {
      errEl.textContent = 'Passwörter stimmen nicht überein';
      errEl.style.display = 'block';
      return;
    }
    try {
      await api('/api/setup', { method: 'POST', body: JSON.stringify({ username, password }) });
      const me = await api('/api/me');
      state.user = me.user;
      state.setupRequired = false;
      navigate('#/sites');
      toast('Willkommen bei sitehost', 'success');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  });
}

// ---------- Login ----------
function renderLogin(root) {
  root.innerHTML = `
    <div class="auth-stage">
      <div class="auth-card">
        <div class="auth-eyebrow">Anmeldung</div>
        <h1 class="auth-title">Willkommen <em>zurück</em></h1>
        <p class="auth-subtitle">Melde dich an, um deine Sites zu verwalten.</p>
        <form id="login-form">
          <div class="field">
            <label>Benutzername</label>
            <input class="input" type="text" name="username" autocomplete="username" required>
          </div>
          <div class="field">
            <label>Passwort</label>
            <input class="input" type="password" name="password" autocomplete="current-password" required>
          </div>
          <div id="login-error" class="error-text" style="display:none"></div>
          <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">Anmelden</button>
        </form>
      </div>
    </div>
  `;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = $('#login-error');
    errEl.style.display = 'none';
    try {
      await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }),
      });
      const me = await api('/api/me');
      state.user = me.user;
      navigate('#/sites');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  });
}

// ---------- Sites Liste ----------
async function renderSitesList(content) {
  content.innerHTML = `
    <div class="page-head">
      <div class="page-head-left">
        <span class="page-eyebrow">Deine Sites</span>
        <h1 class="page-title">Übersicht <em>—</em></h1>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="new-site-btn">+ Neue Site</button>
      </div>
    </div>
    <div id="sites-list"><span class="spinner"></span></div>
  `;
  $('#new-site-btn').addEventListener('click', () => openNewSiteModal());

  try {
    const data = await api('/api/sites');
    state.sites = data.sites;
    const list = $('#sites-list');
    if (state.sites.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <h3>Noch keine Sites</h3>
          <p>Lege deine erste statische Website an und lade HTML, CSS und JS hoch.</p>
          <button class="btn btn-primary" style="margin-top:1.5rem" onclick="document.getElementById('new-site-btn').click()">Erste Site anlegen</button>
        </div>
      `;
      return;
    }
    list.innerHTML = `<div class="sites-grid"></div>`;
    const grid = $('.sites-grid');
    state.sites.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'site-card';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.6rem">
          <h3 class="site-name">${escapeHtml(s.name)}</h3>
          <span class="site-status">
            <span class="dot ${s.proxy_enabled ? 'live' : ''}"></span>
            ${s.proxy_enabled ? 'live' : 'lokal'}
          </span>
        </div>
        <span class="site-slug">${escapeHtml(s.slug)}</span>
        ${s.custom_domain ? `<span class="hint">→ ${escapeHtml(s.custom_domain)}</span>` : ''}
        <div class="site-meta">
          <span><b>${s.file_count}</b> Dateien</span>
          <span>aktualisiert ${formatRelative(s.updated_at)}</span>
        </div>
      `;
      card.addEventListener('click', () => navigate(`#/sites/${s.id}`));
      grid.appendChild(card);
    });
  } catch (e) {
    $('#sites-list').innerHTML = `<div class="error-text">${escapeHtml(e.message)}</div>`;
  }
}

function openNewSiteModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal">
      <h3>Neue Site anlegen</h3>
      <p>Wähle einen Namen und einen URL-Slug für deine Site.</p>
      <form id="new-site-form">
        <div class="field">
          <label>Name</label>
          <input class="input" name="name" required maxlength="64" placeholder="z.B. Portfolio">
        </div>
        <div class="field">
          <label>Slug</label>
          <input class="input mono" name="slug" required pattern="[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?" placeholder="z.B. portfolio">
          <span class="hint">a-z, 0-9, Bindestrich · 1-40 Zeichen</span>
        </div>
        <div id="new-site-error" class="error-text" style="display:none"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Abbrechen</button>
          <button type="submit" class="btn btn-primary">Anlegen</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.dataset.cancel !== undefined) modal.remove();
  });

  // auto-slug aus name
  const nameI = $('input[name="name"]', modal);
  const slugI = $('input[name="slug"]', modal);
  let slugTouched = false;
  slugI.addEventListener('input', () => (slugTouched = true));
  nameI.addEventListener('input', () => {
    if (!slugTouched) {
      slugI.value = nameI.value
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    }
  });

  $('#new-site-form', modal).addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = $('#new-site-error', modal);
    errEl.style.display = 'none';
    try {
      const data = await api('/api/sites', {
        method: 'POST',
        body: JSON.stringify({ name: fd.get('name'), slug: fd.get('slug') }),
      });
      modal.remove();
      toast('Site angelegt', 'success');
      navigate(`#/sites/${data.site.id}`);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  });
}

// ---------- Site Detail ----------
async function renderSiteDetail(content, siteId) {
  content.innerHTML = `<a href="#/sites" class="back-link">← Zurück zur Übersicht</a><div id="detail-body"><span class="spinner"></span></div>`;

  let site;
  try {
    const data = await api(`/api/sites/${siteId}`);
    site = data.site;
  } catch (e) {
    $('#detail-body').innerHTML = `<div class="error-text">${escapeHtml(e.message)}</div>`;
    return;
  }

  $('#detail-body').innerHTML = `
    <div class="page-head">
      <div class="page-head-left">
        <span class="page-eyebrow">Site · ${escapeHtml(site.slug)}</span>
        <h1 class="page-title" id="site-name-display">${escapeHtml(site.name)}</h1>
        <div style="display:flex;gap:.6rem;align-items:center;margin-top:.4rem">
          <a class="url-pill" href="/preview/${encodeURIComponent(site.slug)}/" target="_blank">
            Preview · /preview/${escapeHtml(site.slug)}/
          </a>
          ${site.custom_domain && site.proxy_enabled
            ? `<a class="url-pill" href="http://${escapeHtml(site.custom_domain)}/" target="_blank">→ ${escapeHtml(site.custom_domain)}</a>`
            : ''}
        </div>
      </div>
      <div class="page-actions">
        <button class="btn btn-danger" id="delete-site-btn">Site löschen</button>
      </div>
    </div>

    <div class="detail-grid">
      <div class="panel">
        <div class="panel-head">
          <h2 class="panel-title">Dateien</h2>
          <span class="panel-eyebrow">html · css · js · zip</span>
        </div>
        <div class="dropzone" id="dropzone">
          <div class="dropzone-icon">↑</div>
          <p>Dateien hierher ziehen oder klicken</p>
          <small>Einzelne Dateien, ganze Ordner oder ein .zip</small>
          <div class="dropzone-actions">
            <button class="btn btn-sm" id="pick-files">Dateien</button>
            <button class="btn btn-sm" id="pick-folder">Ordner</button>
            <button class="btn btn-sm" id="pick-zip">ZIP</button>
          </div>
          <label class="toggle" style="margin-top:1rem">
            <input type="checkbox" id="replace-toggle">
            <span class="toggle-track"></span>
            <span>Vorhandene Dateien ersetzen</span>
          </label>
        </div>
        <input type="file" id="file-input" multiple hidden>
        <input type="file" id="folder-input" multiple webkitdirectory hidden>
        <input type="file" id="zip-input" accept=".zip" hidden>
        <div id="upload-progress"></div>
        <div class="file-list" id="file-list"><div style="padding:.75rem;color:var(--text-faint)">Lade…</div></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2 class="panel-title">Einstellungen</h2>
          <span class="panel-eyebrow">domain · proxy</span>
        </div>

        <div class="setting-row">
          <h4>Name</h4>
          <input class="input" id="set-name" value="${escapeHtml(site.name)}">
        </div>

        <div class="setting-row">
          <h4>Eigene Domain</h4>
          <p>Trage hier deine Domain ein (z.B. <code>www.example.com</code>) und richte einen DNS A-Record auf diese Maschine.</p>
          <input class="input mono" id="set-domain" value="${escapeHtml(site.custom_domain || '')}" placeholder="example.com">
        </div>

        <div class="setting-row">
          <h4>Reverse Proxy aktivieren</h4>
          <p>Wenn aktiv, wird ein nginx-vhost erzeugt, der die Domain auf Port 80 ausliefert.</p>
          <label class="toggle">
            <input type="checkbox" id="set-proxy" ${site.proxy_enabled ? 'checked' : ''}>
            <span class="toggle-track"></span>
            <span id="proxy-label">${site.proxy_enabled ? 'Aktiviert' : 'Deaktiviert'}</span>
          </label>
        </div>

        <div class="setting-row">
          <button class="btn btn-primary" id="save-settings">Änderungen speichern</button>
        </div>
      </div>
    </div>
  `;

  bindUploaders(site);
  await refreshFileList(site);

  $('#set-proxy').addEventListener('change', (e) => {
    $('#proxy-label').textContent = e.target.checked ? 'Aktiviert' : 'Deaktiviert';
  });

  $('#save-settings').addEventListener('click', async () => {
    const btn = $('#save-settings');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Speichern…';
    try {
      const body = {
        name: $('#set-name').value,
        custom_domain: $('#set-domain').value.trim() || null,
        proxy_enabled: $('#set-proxy').checked,
      };
      const data = await api(`/api/sites/${site.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast('Einstellungen gespeichert', 'success');
      if (data.nginx && !data.nginx.ok) {
        toast('Nginx Reload Warnung: ' + data.nginx.error, 'error');
      }
      navigate(`#/sites/${site.id}`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Änderungen speichern';
    }
  });

  $('#delete-site-btn').addEventListener('click', () => {
    confirmModal({
      title: 'Site wirklich löschen?',
      body: `<strong>${escapeHtml(site.name)}</strong> und alle Dateien werden unwiderruflich gelöscht. Auch die nginx-Konfiguration wird entfernt.`,
      confirmText: 'Endgültig löschen',
      danger: true,
      onConfirm: async () => {
        try {
          await api(`/api/sites/${site.id}`, { method: 'DELETE' });
          toast('Site gelöscht', 'success');
          navigate('#/sites');
        } catch (e) {
          toast(e.message, 'error');
        }
      },
    });
  });
}

function bindUploaders(site) {
  const dz = $('#dropzone');
  const fileInput = $('#file-input');
  const folderInput = $('#folder-input');
  const zipInput = $('#zip-input');

  $('#pick-files').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  $('#pick-folder').addEventListener('click', (e) => { e.stopPropagation(); folderInput.click(); });
  $('#pick-zip').addEventListener('click', (e) => { e.stopPropagation(); zipInput.click(); });

  dz.addEventListener('click', () => fileInput.click());

  ['dragenter', 'dragover'].forEach((ev) => {
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragging'); });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragging'); });
  });

  dz.addEventListener('drop', async (e) => {
    const items = e.dataTransfer.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      const files = await readDataTransferItems(items);
      uploadFiles(site, files);
    } else {
      uploadFiles(site, [...e.dataTransfer.files].map((f) => ({ file: f, path: f.name })));
    }
  });

  fileInput.addEventListener('change', (e) => {
    uploadFiles(site, [...e.target.files].map((f) => ({ file: f, path: f.name })));
    e.target.value = '';
  });
  folderInput.addEventListener('change', (e) => {
    uploadFiles(site, [...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })));
    e.target.value = '';
  });
  zipInput.addEventListener('change', (e) => {
    uploadFiles(site, [...e.target.files].map((f) => ({ file: f, path: f.name })));
    e.target.value = '';
  });
}

function readDataTransferItems(items) {
  const files = [];
  const promises = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry();
    if (entry) promises.push(traverseEntry(entry, '', files));
  }
  return Promise.all(promises).then(() => files);
}

function traverseEntry(entry, prefix, out) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => {
        out.push({ file, path: prefix + entry.name });
        resolve();
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      reader.readEntries((entries) => {
        Promise.all(entries.map((e) => traverseEntry(e, prefix + entry.name + '/', out))).then(resolve);
      });
    } else {
      resolve();
    }
  });
}

async function uploadFiles(site, files) {
  if (!files || files.length === 0) return;
  const replace = $('#replace-toggle')?.checked;
  const fd = new FormData();
  for (const { file, path } of files) {
    // Multer Pfad-Information über originalname
    fd.append('files', file, path);
  }
  if (replace) fd.append('replace', '1');

  const progress = $('#upload-progress');
  progress.innerHTML = `<div class="hint" style="margin:.5rem 0"><span class="spinner"></span> ${files.length} Datei(en) hochladen…</div>`;
  try {
    const data = await apiUpload(`/api/sites/${site.id}/upload`, fd);
    progress.innerHTML = '';
    const msg = data.zipExpanded
      ? `ZIP entpackt: ${data.zipExpanded} Dateien`
      : `${data.written} Datei(en) hochgeladen`;
    toast(msg, 'success');
    await refreshFileList(site);
  } catch (e) {
    progress.innerHTML = `<div class="error-text">${escapeHtml(e.message)}</div>`;
    toast(e.message, 'error');
  }
}

async function refreshFileList(site) {
  try {
    const data = await api(`/api/sites/${site.id}/files`);
    const list = $('#file-list');
    if (data.files.length === 0) {
      list.innerHTML = `<div style="padding:.75rem;color:var(--text-faint)">Noch keine Dateien</div>`;
      return;
    }
    list.innerHTML = '';
    for (const f of data.files) {
      const row = document.createElement('div');
      row.className = 'file-row';
      const icon = f.type === 'dir' ? '▸' : '◦';
      row.innerHTML = `
        <span class="file-icon">${icon}</span>
        <span class="file-name ${f.type === 'dir' ? 'dir' : ''}">${escapeHtml(f.path)}</span>
        ${f.type === 'file' ? `<span class="file-size">${formatBytes(f.size)}</span>` : ''}
        <button class="file-del" data-path="${escapeHtml(f.path)}" title="Löschen">×</button>
      `;
      row.querySelector('.file-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`"${f.path}" löschen?`)) return;
        try {
          await api(`/api/sites/${site.id}/files?path=${encodeURIComponent(f.path)}`, { method: 'DELETE' });
          await refreshFileList(site);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      list.appendChild(row);
    }
  } catch (e) {
    $('#file-list').innerHTML = `<div class="error-text" style="padding:.75rem">${escapeHtml(e.message)}</div>`;
  }
}

// ---------- Generic Confirm Modal ----------
function confirmModal({ title, body, confirmText = 'Bestätigen', danger = false, onConfirm }) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal">
      <h3>${escapeHtml(title)}</h3>
      <p>${body}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-cancel>Abbrechen</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${escapeHtml(confirmText)}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', async (e) => {
    if (e.target === modal || e.target.dataset.cancel !== undefined) modal.remove();
    else if (e.target.dataset.confirm !== undefined) {
      modal.remove();
      await onConfirm();
    }
  });
}

// ---------- Helpers ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(2) + ' MB';
}

function formatRelative(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'gerade eben';
  const m = Math.floor(s / 60);
  if (m < 60) return `vor ${m} Min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.floor(h / 24);
  if (d < 30) return `vor ${d} Tg`;
  return new Date(ts).toLocaleDateString('de-DE');
}
