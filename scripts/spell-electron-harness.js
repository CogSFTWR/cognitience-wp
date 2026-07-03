/**
 * Electron harness: IPCMainRegistry.registerAll + WindowManager.createMainWindow +
 * real Chromium context-menu on misspelled contenteditable text.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
app.commandLine.appendSwitch('enable-spell-checking');
const SCRATCH = process.env.GROK_SCRATCH || path.join(os.tmpdir(), 'grok-goal-129f57e80eb5', 'implementer');
const LOG_PATH = path.join(SCRATCH, `spell-electron-harness-${Date.now()}.log`);
const CUSTOM_WORD = 'CognitienceXyz';
const MISSPELLED = 'speling';
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

function getHarnessHtml() {
  return `<!DOCTYPE html><html lang="en"><body style="margin:20px">
<div contenteditable="true" spellcheck="true" id="ed" style="font-size:28px;line-height:1.4;min-height:60px" lang="en"></div>
</body></html>`;
}

function startHarnessServer() {
  const html = getHarnessHtml();
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

function getSpellReplaceSrc() {
  return fs.readFileSync(path.join(ROOT, 'dist', 'renderer', 'spell-replace.js'), 'utf-8');
}

async function waitForLoad(win, timeoutMs = 15000) {
  await Promise.race([
    win.webContents.isLoading()
      ? new Promise((resolve) => win.webContents.once('did-finish-load', resolve))
      : Promise.resolve(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('page load timeout')), timeoutMs)),
  ]);
}

async function waitForPreload(win) {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const ok = await win.webContents.executeJavaScript(
      '!!(window.cognitience && window.cognitience.spell)',
    );
    if (ok) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('preload spell API not ready');
}

async function injectSpellReplace(win) {
  await win.webContents.executeJavaScript(getSpellReplaceSrc());
  const ok = await win.webContents.executeJavaScript(
    '!!(window.SpellReplace && window.SpellReplace.replaceMisspelledWord)',
  );
  if (!ok) throw new Error('SpellReplace injection failed');
}

async function waitForSpellContext(getLastSpellContext, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ctx = getLastSpellContext();
    if (ctx && ctx.misspelledWord) return ctx;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

async function triggerRealContextMenu(win) {
  let contextFired = false;
  let lastParams = null;
  const onContextMenu = (_event, params) => {
    lastParams = params;
    if (params.misspelledWord) contextFired = true;
  };
  win.webContents.on('context-menu', onContextMenu);

  await win.webContents.executeJavaScript(`
    (() => {
      const ed = document.getElementById('ed');
      ed.focus();
      const textNode = ed.firstChild;
      const range = document.createRange();
      range.setStart(textNode, 2);
      range.setEnd(textNode, 2);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    })()
  `);

  const coords = await win.webContents.executeJavaScript(`
    (() => {
      const ed = document.getElementById('ed');
      const textNode = ed.firstChild;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, ${MISSPELLED.length});
      const rect = range.getBoundingClientRect();
      range.setStart(textNode, 2);
      range.setEnd(textNode, 2);
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        w: rect.width,
        h: rect.height,
        spellcheckEnabled: ed.spellcheck,
      };
    })()
  `);

  win.webContents.sendInputEvent({
    type: 'mouseDown',
    x: coords.x,
    y: coords.y,
    button: 'right',
    clickCount: 1,
  });
  win.webContents.sendInputEvent({
    type: 'mouseUp',
    x: coords.x,
    y: coords.y,
    button: 'right',
    clickCount: 1,
  });

  const clickStart = Date.now();
  while (!contextFired && Date.now() - clickStart < 5000) {
    await new Promise((r) => setTimeout(r, 50));
  }
  win.webContents.removeListener('context-menu', onContextMenu);

  return { coords, contextFired, lastParams };
}

async function runHarness() {
  log('=== Spell Electron harness (IPCMainRegistry + WindowManager + real context-menu) ===');

  fs.mkdirSync(SCRATCH, { recursive: true });
  app.setPath('userData', path.join(SCRATCH, 'electron-userdata'));

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
  log('IPCMainRegistry.registerAll() — same startup path as index.ts');

  const { server: harnessServer, url: harnessUrl } = await startHarnessServer();
  log(`harness HTTP server: ${harnessUrl}`);

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
  assert(windowManager.getMainWindow() === win, 'windowManager.getMainWindow must return harness window');
  log('harness BrowserWindow created');

  const session = win.webContents.session;
  session.setSpellCheckerLanguages(['en-US']);
  session.setSpellCheckerEnabled(true);
  log(`session spellchecker enabled: ${session.isSpellCheckerEnabled()}, langs: ${session.getSpellCheckerLanguages().join(',')}`);
  attachSpellContextMenu(win);

  await Promise.race([
    win.loadURL(harnessUrl),
    new Promise((_, reject) => setTimeout(() => reject(new Error('loadURL timeout')), 10000)),
  ]);
  log('harness page loaded (http://)');
  await waitForPreload(win);
  log('preload ready');
  await injectSpellReplace(win);
  log('SpellReplace injected');
  win.show();
  win.focus();
  await win.webContents.focus();

  await win.webContents.executeJavaScript(`document.getElementById('ed').focus()`);
  await win.webContents.insertText(`${MISSPELLED} test`);
  log('insertText typed misspelled sample');
  await new Promise((r) => setTimeout(r, 6000));

  clearLastSpellContext();
  await win.webContents.executeJavaScript('window.cognitience.spell.clearContext()');

  const click = await triggerRealContextMenu(win);
  log(`real right-click at (${click.coords.x}, ${click.coords.y}) rect=${click.coords.w}x${click.coords.h} on "${MISSPELLED}" (context-menu fired: ${click.contextFired})`);
  if (!click.contextFired) {
    log(`last context-menu params: ${JSON.stringify(click.lastParams)}`);
  }
  assert(click.contextFired, 'Chromium must fire context-menu on real right-click over misspelled word');

  const mainCtx = await waitForSpellContext(getLastSpellContext, 10000);
  assert(mainCtx && mainCtx.misspelledWord, 'Chromium context-menu must set misspelledWord via attachSpellContextMenu');
  assert(mainCtx.misspelledWord === MISSPELLED,
    `expected misspelledWord "${MISSPELLED}", got "${mainCtx.misspelledWord}"`);
  assert(mainCtx.suggestions.length >= 1,
    `real dictionarySuggestions expected, got ${JSON.stringify(mainCtx.suggestions)}`);
  log(`real context-menu → main: ${mainCtx.misspelledWord} → ${mainCtx.suggestions.slice(0, 3).join(', ')}`);

  const rendererCtx = await win.webContents.executeJavaScript('window.cognitience.spell.waitForContext(500)');
  assert(rendererCtx && rendererCtx.misspelledWord === MISSPELLED,
    `renderer waitForContext failed: ${JSON.stringify(rendererCtx)}`);
  log(`renderer spell.waitForContext: ${rendererCtx.misspelledWord} → ${rendererCtx.suggestions.slice(0, 3).join(', ')}`);

  const fixResult = await win.webContents.executeJavaScript(`
    (async () => {
      const ctx = await window.cognitience.spell.waitForContext(200);
      const ok = window.SpellReplace.replaceMisspelledWord(
        document.getElementById('ed'), ctx.misspelledWord, 'spelling');
      return { ok, text: document.getElementById('ed').innerText.trim() };
    })()
  `);
  assert(fixResult.ok, 'replaceMisspelledWord should succeed in renderer');
  assert(fixResult.text === 'spelling test', `correction expected "spelling test", got "${fixResult.text}"`);
  log(`apply correction: ${MISSPELLED} → spelling test (${fixResult.text})`);

  const addRes = await win.webContents.executeJavaScript('window.cognitience.spell.addWord("HarnessRuntimeWord")');
  assert(addRes && addRes.success === true, 'spell:addWord via preload should succeed');
  const mainWin = windowManager.getMainWindow();
  assert(mainWin === win, 'spell:addWord must use windowManager.getMainWindow() session');
  const afterAdd = await mainWin.webContents.session.listWordsInSpellCheckerDictionary();
  assert(afterAdd.map((w) => w.toLowerCase()).includes('harnessruntimeword'),
    `session should list HarnessRuntimeWord, got ${afterAdd.join(', ')}`);
  log('spell:addWord via windowManager.getMainWindow() + session: ok');

  for (const w of await session.listWordsInSpellCheckerDictionary()) {
    session.removeWordFromSpellCheckerDictionary(w);
  }
  preloadCustomDictionary(win, configStore);

  const afterRestart = await session.listWordsInSpellCheckerDictionary();
  assert(afterRestart.map((w) => w.toLowerCase()).includes(CUSTOM_WORD.toLowerCase()),
    `custom word should persist after preloadCustomDictionary restart simulation, got ${afterRestart.join(', ')}`);
  log(`preloadCustomDictionary restart: ${CUSTOM_WORD} in session (${afterRestart.length} word(s))`);

  harnessServer.close();
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