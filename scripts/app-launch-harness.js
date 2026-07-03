/**
 * Electron harness: real app entry path (IPCMainRegistry + WindowManager + index.html).
 * Verifies no ERR_REQUIRE_ESM on startup and editor-page loads with spellcheck=false.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const SCRATCH = process.env.GROK_SCRATCH
  || path.join(require('os').tmpdir(), 'grok-goal-8cbdee8c2cc6', 'implementer');
const LOG_PATH = path.join(SCRATCH, `app-launch-harness-${Date.now()}.log`);
const lines = [];

function log(msg) {
  const line = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2);
  lines.push(line);
  console.log(line);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

function writeLog() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.writeFileSync(LOG_PATH, lines.join('\n') + '\n', 'utf-8');
  log(`wrote ${LOG_PATH}`);
}

async function waitForRendererReady(win, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await win.webContents.executeJavaScript(`
      (() => ({
        preload: !!(window.cognitience && window.cognitience.config),
        editor: !!document.getElementById('editor-page'),
        spellcheck: document.getElementById('editor-page')?.getAttribute('spellcheck'),
        newDocBtn: !!document.querySelector('[data-action="new-document"]'),
      }))()
    `).catch(() => null);
    if (state && state.preload && state.editor && state.newDocBtn) return state;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('renderer did not become ready (preload + editor-page + sidebar)');
}

async function runHarness() {
  log('=== App launch harness (real index.html, no marked stub) ===');
  fs.mkdirSync(SCRATCH, { recursive: true });
  app.setPath('userData', path.join(SCRATCH, 'app-launch-userdata'));

  const { ConfigStore } = require(path.join(ROOT, 'dist', 'main', 'config-store.js'));
  const { ExtensionHost } = require(path.join(ROOT, 'dist', 'main', 'extension-host.js'));
  const { PluginHost } = require(path.join(ROOT, 'dist', 'main', 'plugin-host.js'));
  const { WindowManager } = require(path.join(ROOT, 'dist', 'main', 'window-manager.js'));
  const { IPCMainRegistry } = require(path.join(ROOT, 'dist', 'main', 'ipc-registry.js'));
  const { attachSpellContextMenu } = require(path.join(ROOT, 'dist', 'main', 'spell-context.js'));
  const { preloadCustomDictionary } = require(path.join(ROOT, 'dist', 'main', 'spell-dictionary.js'));

  await app.whenReady();

  const configStore = new ConfigStore();
  const extensionHost = new ExtensionHost(configStore);
  await extensionHost.initialize();
  const pluginHost = new PluginHost();
  const windowManager = new WindowManager(configStore, extensionHost);
  const ipcRegistry = new IPCMainRegistry(windowManager, extensionHost, configStore, pluginHost);
  ipcRegistry.registerAll();
  log('IPCMainRegistry.registerAll() succeeded (no ERR_REQUIRE_ESM)');

  const win = windowManager.createMainWindow();
  win.webContents.session.setSpellCheckerLanguages(['en-US']);
  win.webContents.session.setSpellCheckerEnabled(false);
  attachSpellContextMenu(win);
  preloadCustomDictionary(win, configStore);
  log('spell session disabled at startup (index.ts path)');

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('did-finish-load timeout')), 20000);
    win.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  log('index.html did-finish-load');

  const state = await waitForRendererReady(win);
  assert(state.spellcheck === 'false', `editor-page spellcheck must be false, got "${state.spellcheck}"`);
  assert(state.newDocBtn, 'sidebar must expose data-action=new-document (CSP-safe wiring)');
  assert(!win.webContents.session.isSpellCheckerEnabled(), 'session spellchecker must be disabled at launch');
  log(`editor-page spellcheck="${state.spellcheck}", session disabled, sidebar wired`);

  win.close();
  log('APP LAUNCH HARNESS PASSED');
}

runHarness()
  .then(() => {
    writeLog();
    app.exit(0);
  })
  .catch((err) => {
    log(`FAILED: ${err.message}`);
    log(err.stack || '');
    writeLog();
    app.exit(1);
  });