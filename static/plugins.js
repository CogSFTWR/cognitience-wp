/**
 * Cognitience WP — plugin host (greenfield).
 * Loads .cogwp packages after core UI boots. Failures disable that plugin only.
 */
(function (root) {
  'use strict';

  const API = '/api';
  const PACKAGE_EXT = 'cogwp';

  const pendingRegisters = [];
  const loaded = new Map(); // id -> { dispose, styleEl, scriptEl, contributions }
  let hostBridge = null;
  let panelBound = false;

  function api(path, options) {
    options = options || {};
    return fetch(API + path, {
      headers:
        options.body instanceof FormData
          ? undefined
          : { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    }).then(async (res) => {
      if (res.status === 204) return null;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
      return data;
    });
  }

  function makePluginApi(pluginId, contributions) {
    if (!hostBridge) {
      throw new Error('Plugin host not ready');
    }
    const storeKey = (k) => `cognitience.plugin.${pluginId}.${k}`;

    const apiObj = {
      id: pluginId,
      doc: {
        getHtml: () => hostBridge.getHtml(),
        setHtml: (html) => hostBridge.setHtml(html),
        getTitle: () => hostBridge.getTitle(),
        setTitle: (t) => hostBridge.setTitle(t),
        getSelection: () => hostBridge.getSelection(),
        insertHtml: (html) => hostBridge.insertHtml(html),
        replaceSelection: (html) => hostBridge.replaceSelection(html),
        onChange: (fn) => {
          const off = hostBridge.onDocChange(fn);
          contributions.disposers.push(off);
          return off;
        },
        onOpen: (fn) => {
          const off = hostBridge.onDocOpen(fn);
          contributions.disposers.push(off);
          return off;
        },
        onSave: (fn) => {
          const off = hostBridge.onDocSave(fn);
          contributions.disposers.push(off);
          return off;
        },
      },
      ui: {
        addToolbarButton: (opts) => {
          const el = hostBridge.addToolbarButton(pluginId, opts);
          if (el) contributions.nodes.push(el);
          return el;
        },
        addSidebarPanel: (opts) => {
          const el = hostBridge.addSidebarPanel(pluginId, opts);
          if (el) contributions.nodes.push(el);
          return el;
        },
        notify: (msg, kind) => hostBridge.notify(msg, kind),
        setStatus: (msg, kind) => hostBridge.setStatus(msg, kind),
      },
      commands: {
        add: (id, handler) => {
          const wrapped = (...args) => {
            try {
              return handler(...args);
            } catch (e) {
              console.error(`[plugin:${pluginId}] command ${id}`, e);
              hostBridge.notify(String(e.message || e), 'error');
              return undefined;
            }
          };
          hostBridge.addCommand(pluginId, id, wrapped);
          contributions.commands.push(id);
        },
        run: (id, ...args) => hostBridge.runCommand(id, ...args),
      },
      files: {
        registerOpener: (spec) => {
          hostBridge.registerOpener(pluginId, spec);
          contributions.openers.push(spec);
        },
      },
      http: {
        fetch: (input, init) => fetch(input, init),
      },
      store: {
        get: (key, fallback) => {
          try {
            const raw = localStorage.getItem(storeKey(key));
            if (raw == null) return fallback;
            return JSON.parse(raw);
          } catch {
            return fallback;
          }
        },
        set: (key, value) => {
          try {
            localStorage.setItem(storeKey(key), JSON.stringify(value));
          } catch {
            /* ignore */
          }
        },
        remove: (key) => {
          try {
            localStorage.removeItem(storeKey(key));
          } catch {
            /* ignore */
          }
        },
      },
    };
    return apiObj;
  }

  const Cognitience = root.Cognitience || {};
  Cognitience.plugin = {
    register: function (fn) {
      if (typeof fn !== 'function') return;
      pendingRegisters.push(fn);
    },
  };
  root.Cognitience = Cognitience;

  async function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = () => resolve(s);
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  function loadStyle(href) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
    return link;
  }

  async function activatePlugin(meta) {
    if (loaded.has(meta.id)) return;
    const contributions = { nodes: [], commands: [], openers: [], disposers: [], dispose: null };
    pendingRegisters.length = 0;

    let styleEl = null;
    let scriptEl = null;
    try {
      if (meta.style) {
        styleEl = loadStyle(
          `${API}/plugins/${encodeURIComponent(meta.id)}/files/${meta.style.split('/').map(encodeURIComponent).join('/')}`
        );
      }
      const mainPath = (meta.main || 'main.js')
        .split('/')
        .map(encodeURIComponent)
        .join('/');
      scriptEl = await loadScript(
        `${API}/plugins/${encodeURIComponent(meta.id)}/files/${mainPath}?t=${Date.now()}`
      );

      if (!pendingRegisters.length) {
        throw new Error('Plugin did not call Cognitience.plugin.register(...)');
      }
      const registerFn = pendingRegisters.pop();
      pendingRegisters.length = 0;
      const pluginApi = makePluginApi(meta.id, contributions);
      const dispose = await registerFn(pluginApi);
      if (typeof dispose === 'function') {
        contributions.dispose = dispose;
      }
      loaded.set(meta.id, { contributions, styleEl, scriptEl });
      await api(`/plugins/${encodeURIComponent(meta.id)}/error`, {
        method: 'POST',
        body: JSON.stringify({ error: null }),
      }).catch(() => {});
    } catch (e) {
      teardownContributions(contributions, styleEl, scriptEl);
      const msg = e && e.message ? e.message : String(e);
      console.error(`[plugin:${meta.id}] activate failed`, e);
      try {
        await api(`/plugins/${encodeURIComponent(meta.id)}/error`, {
          method: 'POST',
          body: JSON.stringify({ error: msg }),
        });
      } catch {
        /* ignore */
      }
      if (hostBridge) hostBridge.notify(`Plugin ${meta.name || meta.id} failed: ${msg}`, 'error');
    }
  }

  function teardownContributions(contributions, styleEl, scriptEl) {
    try {
      if (contributions && typeof contributions.dispose === 'function') {
        contributions.dispose();
      }
    } catch (e) {
      console.warn('plugin dispose error', e);
    }
    if (contributions) {
      (contributions.disposers || []).forEach((off) => {
        try {
          off();
        } catch {
          /* ignore */
        }
      });
      (contributions.nodes || []).forEach((n) => {
        try {
          n.remove();
        } catch {
          /* ignore */
        }
      });
      (contributions.commands || []).forEach((id) => {
        if (hostBridge) hostBridge.removeCommand(id);
      });
      (contributions.openers || []).forEach((spec) => {
        if (hostBridge) hostBridge.removeOpener(spec);
      });
    }
    try {
      if (styleEl) styleEl.remove();
    } catch {
      /* ignore */
    }
    try {
      if (scriptEl) scriptEl.remove();
    } catch {
      /* ignore */
    }
  }

  async function deactivatePlugin(id) {
    const entry = loaded.get(id);
    if (!entry) return;
    teardownContributions(entry.contributions, entry.styleEl, entry.scriptEl);
    loaded.delete(id);
  }

  async function bootEnabled() {
    if (!hostBridge) return;
    try {
      const health = await api('/health');
      if (health && health.plugins === false) return;
      const list = await api('/plugins');
      for (const p of list) {
        if (p.enabled) {
          await activatePlugin(p);
        }
      }
    } catch (e) {
      console.warn('[plugins] boot skipped', e);
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function refreshPanel() {
    const installedEl = document.getElementById('ext-installed');
    const foundEl = document.getElementById('ext-found');
    if (!installedEl || !foundEl) return;

    try {
      const list = await api('/plugins');
      if (!list.length) {
        installedEl.innerHTML = '<p class="ext-empty">No plugins installed yet.</p>';
      } else {
        installedEl.innerHTML = list
          .map((p) => {
            const err = p.error
              ? `<div class="ext-error">${esc(p.error)}</div>`
              : '';
            return `<div class="ext-row" data-id="${esc(p.id)}">
              <div class="ext-meta">
                <strong>${esc(p.name)}</strong>
                <span class="ext-ver">${esc(p.version)} · ${esc(p.id)}</span>
                ${err}
              </div>
              <div class="ext-actions">
                ${
                  p.enabled
                    ? `<button type="button" class="export-chip pressable" data-act="disable">Disable</button>`
                    : `<button type="button" class="export-chip pressable" data-act="enable">Enable</button>`
                }
                <button type="button" class="export-chip pressable" data-act="uninstall">Remove</button>
              </div>
            </div>`;
          })
          .join('');
      }
    } catch (e) {
      installedEl.innerHTML = `<p class="ext-empty">Could not list plugins: ${esc(e.message)}</p>`;
    }

    foundEl.innerHTML = '<p class="ext-empty">Click Search to look for .' + PACKAGE_EXT + ' files.</p>';
  }

  async function runSearch() {
    const foundEl = document.getElementById('ext-found');
    if (!foundEl) return;
    foundEl.innerHTML = '<p class="ext-empty">Searching Documents…</p>';
    try {
      const found = await api('/plugins/search', { method: 'POST', body: '{}' });
      if (!found.length) {
        foundEl.innerHTML =
          '<p class="ext-empty">No .' +
          PACKAGE_EXT +
          ' packages found in Documents (or Downloads).</p>';
        return;
      }
      foundEl.innerHTML = found
        .map((f) => {
          const title = f.manifest ? f.manifest.name : f.name;
          const sub = f.manifest
            ? `${esc(f.manifest.version)} · ${esc(f.manifest.id)}`
            : esc(f.error || 'Invalid package');
          const can = f.manifest && !f.error;
          return `<div class="ext-row" data-path="${esc(f.path)}">
            <div class="ext-meta">
              <strong>${esc(title)}</strong>
              <span class="ext-ver">${sub}</span>
              <span class="ext-ver">${esc(f.path)}</span>
            </div>
            <div class="ext-actions">
              ${
                can
                  ? `<button type="button" class="export-chip pressable" data-act="activate">Activate</button>`
                  : ''
              }
            </div>
          </div>`;
        })
        .join('');
    } catch (e) {
      foundEl.innerHTML = `<p class="ext-empty">${esc(e.message)}</p>`;
    }
  }

  function openPanel() {
    const panel = document.getElementById('extensions-panel');
    if (!panel) return;
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
    refreshPanel();
  }

  function closePanel() {
    const panel = document.getElementById('extensions-panel');
    if (!panel) return;
    panel.classList.add('hidden');
    panel.setAttribute('aria-hidden', 'true');
  }

  function bindPanel() {
    if (panelBound) return;
    panelBound = true;
    const btn = document.getElementById('extensions-btn');
    const panel = document.getElementById('extensions-panel');
    const fileInput = document.getElementById('plugin-file-input');
    if (btn) btn.addEventListener('click', () => openPanel());
    if (panel) {
      panel.addEventListener('click', async (e) => {
        const t = e.target;
        if (t && t.getAttribute && t.getAttribute('data-close') === 'extensions') {
          closePanel();
          return;
        }
        const actBtn = t.closest && t.closest('[data-act]');
        if (!actBtn) return;
        const act = actBtn.getAttribute('data-act');
        const row = actBtn.closest('.ext-row');
        try {
          if (act === 'search') {
            await runSearch();
            return;
          }
          if (act === 'install-file') {
            if (fileInput) fileInput.click();
            return;
          }
          if (act === 'activate' && row) {
            const path = row.getAttribute('data-path');
            const installed = await api('/plugins/install-path', {
              method: 'POST',
              body: JSON.stringify({ path }),
            });
            await activatePlugin(installed);
            if (hostBridge) hostBridge.notify(`Activated ${installed.name}`);
            await refreshPanel();
            return;
          }
          if (act === 'enable' && row) {
            const id = row.getAttribute('data-id');
            const p = await api(`/plugins/${encodeURIComponent(id)}/enable`, {
              method: 'POST',
              body: '{}',
            });
            await activatePlugin(p);
            await refreshPanel();
            return;
          }
          if (act === 'disable' && row) {
            const id = row.getAttribute('data-id');
            await deactivatePlugin(id);
            await api(`/plugins/${encodeURIComponent(id)}/disable`, {
              method: 'POST',
              body: '{}',
            });
            await refreshPanel();
            return;
          }
          if (act === 'uninstall' && row) {
            const id = row.getAttribute('data-id');
            await deactivatePlugin(id);
            await api(`/plugins/${encodeURIComponent(id)}/uninstall`, {
              method: 'POST',
              body: '{}',
            });
            await refreshPanel();
          }
        } catch (err) {
          if (hostBridge) hostBridge.notify(String(err.message || err), 'error');
        }
      });
    }
    if (fileInput) {
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file, file.name);
        try {
          const installed = await api('/plugins', { method: 'POST', body: fd });
          await activatePlugin(installed);
          if (hostBridge) hostBridge.notify(`Installed ${installed.name}`);
          await refreshPanel();
        } catch (err) {
          if (hostBridge) hostBridge.notify(String(err.message || err), 'error');
        }
      });
    }
  }

  /**
   * Attach the host bridge from script.js, then load enabled plugins.
   * Must be called after core editor init.
   */
  async function attach(bridge) {
    hostBridge = bridge;
    bindPanel();
    await bootEnabled();
  }

  root.CognitiencePlugins = {
    attach,
    openPanel,
    closePanel,
    packageExt: PACKAGE_EXT,
  };
})(typeof window !== 'undefined' ? window : globalThis);
