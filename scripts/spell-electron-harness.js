/**
 * Electron harness: mirrors index.ts startup (IPCMainRegistry.registerAll) +
 * real BrowserWindow, context-menu spell path, correction, dictionary preload.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const SCRATCH = process.env.GROK_SCRATCH || path.join(os.tmpdir(), 'cogwp-spell-harness');
const LOG_PATH = path.join(SCRATCH, `spell-electron-harness-${Date.now()}.log`);
const CUSTOM_WORD = 'CognitienceXyz';
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

async function waitForPreload(win) {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const ok = await win.webContents.executeJavaScript('!!(window.cognitience && window.cognitience.spell)');
    if (ok) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('preload spell API not ready');
}

function stubEsmDepsForHarness() {
  const Module = require('module');
  const markedResolve = require.resolve('marked');
  Module._cache[markedResolve] = {
    id: markedResolve,
    exports: { marked: (src) => src, parse: () => '' },
    loaded: true,
  };
  const mammothResolve = require.resolve('mammoth');
  const mammothStub = {
    extractRawText: async () => ({ value: '' }),
    convertToHtml: async () => ({ value: '' }),
  };
  Module._cache[mammothResolve] = {
    id: mammothResolve,
    exports: { __esModule: true, default: mammothStub, ...mammothStub },
    loaded: true,
  };
}

async function runHarness() {
  log('=== Spell Electron harness (IPCMainRegistry + real window + correction) ===');

  stubEsmDepsForHarness();

  const { ConfigStore } = require(path.join(ROOT, 'dist', 'main', 'config-store.js'));
  const { ExtensionHost } = require(path.join(ROOT, 'dist', 'main', 'extension-host.js'));
  const { PluginHost } = require(path.join(ROOT, 'dist', 'main', 'plugin-host.js'));
  const { WindowManager } = require(path.join(ROOT, 'dist', 'main', 'window-manager.js'));
  const { IPCMainRegistry } = require(path.join(ROOT, 'dist', 'main', 'ipc-registry.js'));
  const {
    attachSpellContextMenu,
    getLastSpellContext,
    clearLastSpellContext,
  } = require(path.join(ROOT, 'dist', 'main', 'spell-context.js'));
  const { preloadCustomDictionary } = require(path.join(ROOT, 'dist', 'main', 'spell-dictionary.js'));

  await app.whenReady();

  const configStore = new ConfigStore();
  configStore.set('editor.customDictionary', [CUSTOM_WORD]);

  const extensionHost = new ExtensionHost(configStore);
  await extensionHost.initialize();
  const pluginHost = new PluginHost();
  const windowManager = new WindowManager(configStore, extensionHost);
  const ipcRegistry = new IPCMainRegistry(windowManager, extensionHost, configStore, pluginHost);
  ipcRegistry.registerAll();

  const ipcRegistrySrc = fs.readFileSync(path.join(ROOT, 'dist', 'main', 'ipc-registry.js'), 'utf-8');
  assert(ipcRegistrySrc.includes('registerSpellIpcHandlers'),
    'IPCMainRegistry must register spell handlers via registerSpellIpcHandlers');
  log('IPCMainRegistry.registerAll() — same startup path as index.ts');

  const spellReplaceSrc = fs.readFileSync(
    path.join(ROOT, 'dist', 'renderer', 'spell-replace.js'),
    'utf-8',
  );
  const html = `<!doctype html><html><body>
<div contenteditable spellcheck id="ed">speling test</div>
<script>${spellReplaceSrc}</script>
</body></html>`;

  const win = new BrowserWindow({
    show: false,
    width: 640,
    height: 480,
    webPreferences: {
      preload: path.join(ROOT, 'dist', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      additionalArguments: [`--cognitience-version=${require(path.join(ROOT, 'package.json')).version}`],
    },
  });

  const session = win.webContents.session;
  session.setSpellCheckerLanguages(['en-US']);
  session.setSpellCheckerEnabled(true);
  attachSpellContextMenu(win);

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await waitForPreload(win);

  clearLastSpellContext();
  const menuParams = {
    misspelledWord: 'speling',
    dictionarySuggestions: ['spelling', 'speeling', 'spieling'],
    x: 42,
    y: 36,
    isEditable: true,
  };

  win.webContents.emit('context-menu', { preventDefault: () => {} }, menuParams);

  const mainCtx = getLastSpellContext();
  assert(mainCtx && mainCtx.misspelledWord === 'speling', 'main getLastSpellContext after context-menu emit');
  assert(mainCtx.suggestions.length >= 2, 'main context should capture dictionarySuggestions');
  log(`context-menu emit → main: ${mainCtx.misspelledWord} → ${mainCtx.suggestions.slice(0, 3).join(', ')}`);

  const rendererCtx = await win.webContents.executeJavaScript('window.cognitience.spell.getContext()');
  assert(rendererCtx && rendererCtx.misspelledWord === 'speling',
    `renderer getContext failed: ${JSON.stringify(rendererCtx)}`);
  assert(Array.isArray(rendererCtx.suggestions) && rendererCtx.suggestions.length >= 2,
    'renderer getContext should return suggestions');
  log(`renderer spell.getContext: ${rendererCtx.misspelledWord} → ${rendererCtx.suggestions.slice(0, 3).join(', ')}`);

  const fixResult = await win.webContents.executeJavaScript(`
    (async () => {
      const ctx = await window.cognitience.spell.getContext();
      const ok = window.SpellReplace.replaceMisspelledWord(
        document.getElementById('ed'), ctx.misspelledWord, 'spelling');
      return { ok, text: document.getElementById('ed').innerText.trim() };
    })()
  `);
  assert(fixResult.ok, 'replaceMisspelledWord should succeed in renderer');
  assert(fixResult.text === 'spelling test', `correction expected "spelling test", got "${fixResult.text}"`);
  log(`apply correction: speling → spelling test (${fixResult.text})`);

  const addRes = await win.webContents.executeJavaScript('window.cognitience.spell.addWord("HarnessRuntimeWord")');
  assert(addRes && addRes.success === true, 'spell:addWord via preload should succeed');
  const afterAdd = await session.listWordsInSpellCheckerDictionary();
  assert(afterAdd.map((w) => w.toLowerCase()).includes('harnessruntimeword'),
    `session should list HarnessRuntimeWord, got ${afterAdd.join(', ')}`);
  log('spell:addWord via real IPC + session: ok');

  for (const w of await session.listWordsInSpellCheckerDictionary()) {
    session.removeWordFromSpellCheckerDictionary(w);
  }
  preloadCustomDictionary(win, configStore);

  const afterRestart = await session.listWordsInSpellCheckerDictionary();
  assert(afterRestart.map((w) => w.toLowerCase()).includes(CUSTOM_WORD.toLowerCase()),
    `custom word should persist after preloadCustomDictionary restart simulation, got ${afterRestart.join(', ')}`);
  log(`preloadCustomDictionary restart: ${CUSTOM_WORD} in session (${afterRestart.length} word(s))`);

  win.close();
  log('SPELL ELECTRON HARNESS PASSED');
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