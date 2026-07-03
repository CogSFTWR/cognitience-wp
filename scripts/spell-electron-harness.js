/**
 * Electron harness: session custom dictionary via real webContents.session APIs.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const SCRATCH = process.env.GROK_SCRATCH || path.join(__dirname, '..', '..');
const LOG_PATH = path.join(SCRATCH, 'spell-electron-harness.log');
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
  try {
    fs.writeFileSync(LOG_PATH, lines.join('\n') + '\n', 'utf-8');
  } catch (e) {
    console.error('Could not write harness log:', e.message);
  }
}

async function runHarness() {
  log('=== Spell Electron harness (session custom dictionary) ===');

  const { preloadCustomDictionary } = require(path.join(ROOT, 'dist', 'main', 'spell-dictionary.js'));
  const { ConfigStore } = require(path.join(ROOT, 'dist', 'main', 'config-store.js'));

  await app.whenReady();

  const win = new BrowserWindow({
    show: false,
    webPreferences: { spellcheck: true },
  });

  const session = win.webContents.session;
  session.setSpellCheckerLanguages(['en-US']);
  session.setSpellCheckerEnabled(true);

  const configStore = new ConfigStore();
  configStore.set('editor.customDictionary', [CUSTOM_WORD]);

  for (const w of await session.listWordsInSpellCheckerDictionary()) {
    session.removeWordFromSpellCheckerDictionary(w);
  }

  preloadCustomDictionary(win, configStore);

  const dictWords = await session.listWordsInSpellCheckerDictionary();
  assert(
    dictWords.map((w) => w.toLowerCase()).includes(CUSTOM_WORD.toLowerCase()),
    `custom word should be in session dictionary, got: ${dictWords.join(', ')}`,
  );
  log(`preloadCustomDictionary: ${CUSTOM_WORD} in session (${dictWords.length} word(s))`);

  const added = session.addWordToSpellCheckerDictionary('RuntimeWord');
  assert(added === true, 'addWordToSpellCheckerDictionary should return true');
  const afterRuntime = await session.listWordsInSpellCheckerDictionary();
  assert(afterRuntime.map((w) => w.toLowerCase()).includes('runtimeword'),
    'runtime addWord should persist in session list');
  log(`session.addWordToSpellCheckerDictionary: RuntimeWord ok`);

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