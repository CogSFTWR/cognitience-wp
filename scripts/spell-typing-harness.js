/**
 * Electron harness: type a misspelled word on real #editor-page and assert
 * caret never jumps leftward while session spellcheck stays disabled.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const ROOT = path.join(__dirname, '..');
const SCRATCH = process.env.GROK_SCRATCH
  || path.join(require('os').tmpdir(), 'grok-goal-8cbdee8c2cc6', 'implementer');
const LOG_PATH = path.join(SCRATCH, `spell-typing-harness-${Date.now()}.log`);
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

async function waitForEditor(win, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await win.webContents.executeJavaScript(
      '!!document.getElementById("editor-page")',
    ).catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('#editor-page not found');
}

async function runHarness() {
  log('=== Spell typing harness (real #editor-page caret + session invariant) ===');
  fs.mkdirSync(SCRATCH, { recursive: true });
  app.setPath('userData', path.join(SCRATCH, 'spell-typing-userdata'));

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

  const win = windowManager.createMainWindow();
  const session = win.webContents.session;
  session.setSpellCheckerLanguages(['en-US']);
  session.setSpellCheckerEnabled(false);
  attachSpellContextMenu(win);
  preloadCustomDictionary(win, configStore);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('load timeout')), 20000);
    win.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await waitForEditor(win);
  await new Promise((r) => setTimeout(r, 500));

  assert(!session.isSpellCheckerEnabled(), 'session must start disabled');

  const typingResult = await win.webContents.executeJavaScript(`
    (async () => {
      const ed = document.getElementById('editor-page');
      ed.focus();
      ed.innerHTML = '';
      ed.textContent = '';

      function caretOffset() {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return -1;
        const range = sel.getRangeAt(0);
        if (!ed.contains(range.startContainer)) return -1;
        const pre = document.createRange();
        pre.selectNodeContents(ed);
        pre.setEnd(range.startContainer, range.startOffset);
        return pre.toString().length;
      }

      const steps = [];
      const word = ${JSON.stringify(MISSPELLED)};
      for (let i = 0; i < word.length; i++) {
        const ch = word[i];
        document.execCommand('insertText', false, ch);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        steps.push({
          ch,
          offset: caretOffset(),
          spellcheck: ed.spellcheck,
          spellcheckAttr: ed.getAttribute('spellcheck'),
        });
      }
      return {
        steps,
        text: ed.innerText || ed.textContent || '',
        finalSpellcheck: ed.getAttribute('spellcheck'),
      };
    })()
  `);

  log(`typed "${MISSPELLED}" → text="${typingResult.text}"`);
  assert(typingResult.text.includes(MISSPELLED), `editor should contain "${MISSPELLED}"`);
  assert(typingResult.finalSpellcheck === 'false', 'spellcheck attr must stay false while typing');

  let prevOffset = 0;
  for (const step of typingResult.steps) {
    assert(step.spellcheck === false, `spellcheck property must stay false after "${step.ch}"`);
    assert(step.spellcheckAttr === 'false', `spellcheck attr must stay false after "${step.ch}"`);
    assert(step.offset >= prevOffset,
      `caret jumped left after "${step.ch}": offset ${step.offset} < ${prevOffset}`);
    prevOffset = step.offset;
    log(`  +${step.ch} → caret offset ${step.offset}`);
  }
  assert(prevOffset === MISSPELLED.length, `final caret should be at end (${MISSPELLED.length}), got ${prevOffset}`);

  assert(!session.isSpellCheckerEnabled(), 'session must remain disabled after typing misspelled word');
  log('session still disabled after typing — caret invariant held');

  const manualResult = await win.webContents.executeJavaScript(`
    (() => {
      const ed = document.getElementById('editor-page');
      if (!window.SymSpell || !window.SpellManual) return { ok: false, reason: 'spell libs missing' };
      const checker = new window.SymSpell(2);
      checker.loadDefault();
      const { count } = window.SpellManual.runManualSpellcheck(ed, checker);
      return {
        ok: true,
        count,
        marks: ed.querySelectorAll('.cog-misspelled').length,
        spellcheckAttr: ed.getAttribute('spellcheck'),
      };
    })()
  `);

  assert(manualResult.ok, `manual spellcheck libs: ${manualResult.reason || 'ok'}`);
  assert(manualResult.marks >= 1, 'manual spellcheck should underline misspelled word');
  assert(manualResult.spellcheckAttr === 'false', 'native spellcheck attr must stay false');
  log(`manual spellcheck underlined ${manualResult.marks} word(s)`);

  win.close();
  log('SPELL TYPING HARNESS PASSED');
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