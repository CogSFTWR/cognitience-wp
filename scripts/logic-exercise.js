/**
 * Direct logic exercises against shipped modules (no Electron UI).
 * Drives real entry points from dist/ and renderer helpers.
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SCRATCH = process.env.GROK_SCRATCH || path.join(__dirname, '..', '..');
const LOG_PATH = path.join(SCRATCH, 'logic-exercise.log');
const lines = [];

function log(msg) {
  const line = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2);
  lines.push(line);
  console.log(line);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

let nextSavePath = null;
let sentChannels = [];

const mockIpcMain = {
  _handlers: new Map(),
  handle(channel, fn) { this._handlers.set(channel, fn); },
  handleOnce(channel, fn) { this._handlers.set(`${channel}:once`, fn); },
  removeHandler() {},
};

require('module').Module._cache[require.resolve('electron')] = {
  exports: {
    app: {
      getPath: (name) => path.join(ROOT, '.test-userdata', name),
      requestSingleInstanceLock: () => true,
      whenReady: () => ({ then: (fn) => fn() }),
      on: () => {},
      quit: () => {},
    },
    ipcMain: mockIpcMain,
    BrowserWindow: class {
      static getAllWindows() { return []; }
      static getFocusedWindow() { return null; }
      constructor() {
        this.webContents = {
          loadURL: async () => {},
          printToPDF: async () => Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF'),
          send: () => {},
        };
        this.loadURL = async (url) => this.webContents.loadURL(url);
      }
      close() {}
    },
    dialog: {
      showSaveDialog: async () => {
        if (!nextSavePath) return { canceled: true };
        return { canceled: false, filePath: nextSavePath };
      },
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
    clipboard: { writeText: () => {}, readText: () => '' },
    shell: { openExternal: () => {}, openPath: () => {} },
    Menu: { setApplicationMenu: () => {} },
    nativeImage: { createFromPath: () => null },
    screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }] },
  },
};

const { ExportManager } = require(path.join(ROOT, 'dist', 'main', 'export-manager.js'));
const SymSpell = require(path.join(ROOT, 'src', 'renderer', 'spellsolver.js'));

async function exerciseExports() {
  log('=== ExportManager ===');
  const em = new ExportManager();

  const sampleHtml = '<h1>Hello</h1><p>This is <strong>bold</strong> and <em>italic</em>.</p>';
  const sampleMd = '# Hello\n\nThis is **bold** and *italic*.';

  const htmlFromMd = em.markdownToHtml(sampleMd);
  assert(htmlFromMd.includes('<h1>'), 'markdownToHtml should produce headings');
  assert(htmlFromMd.includes('<strong>'), 'markdownToHtml should produce bold');
  log(`markdownToHtml: ${htmlFromMd.slice(0, 80)}...`);

  const cogBuilt = em.buildCogMarkdown(sampleHtml, 'Test Doc');
  assert(cogBuilt.startsWith('---'), 'buildCogMarkdown should start with frontmatter');
  assert(cogBuilt.includes('magic: COGWP'), 'buildCogMarkdown should include magic');
  log(`buildCogMarkdown length: ${cogBuilt.length}`);

  const parsed = em.parseCogFile(cogBuilt);
  assert(parsed !== null, 'parseCogFile should parse v3 cog');
  assert(parsed.html.includes('Hello'), 'parseCogFile html should roundtrip');
  log(`parseCogFile roundtrip title: ${parsed.frontmatter.title}`);

  const legacy = JSON.stringify({
    magic: 'COGWP',
    version: '2.0.0',
    metadata: { title: 'Legacy', author: 'test' },
    content: { html: '<p>Legacy body</p>', markdown: 'Legacy body' },
    styles: { theme: 'cognitience-light' },
    history: [],
  });
  const legacyParsed = em.parseCogFile(legacy);
  assert(legacyParsed !== null && legacyParsed.isLegacy, 'parseCogFile should handle v2 JSON');
  log('v2 legacy parse: ok');

  const tmpDir = path.join(ROOT, '.test-exports');
  fs.mkdirSync(tmpDir, { recursive: true });

  const exportCases = [
    { format: 'cog', ext: 'cog', minBytes: 50 },
    { format: 'markdown', ext: 'md', minBytes: 10 },
    { format: 'txt', ext: 'txt', minBytes: 5 },
    { format: 'html', ext: 'html', minBytes: 50 },
    { format: 'docx', ext: 'docx', minBytes: 100 },
    { format: 'doc', ext: 'doc', minBytes: 10 },
    { format: 'pdf', ext: 'pdf', minBytes: 4 },
  ];

  for (const { format, ext, minBytes } of exportCases) {
    const outPath = path.join(tmpDir, `export.${ext}`);
    nextSavePath = outPath;
    const result = await em.exportDocument({
      format,
      content: sampleHtml,
      title: 'Export Test',
    });
    assert(result.success, `exportDocument(${format}) should succeed: ${result.error || ''}`);
    assert(fs.existsSync(outPath), `export file should exist: ${outPath}`);
    const stat = fs.statSync(outPath);
    assert(stat.size >= minBytes, `${format} export should be non-empty (${stat.size} bytes)`);
    if (format === 'docx') {
      const buf = fs.readFileSync(outPath);
      assert(buf[0] === 0x50 && buf[1] === 0x4b, 'docx should be a ZIP (PK header)');
    }
    if (format === 'pdf') {
      const head = fs.readFileSync(outPath).slice(0, 8).toString('utf-8');
      assert(head.startsWith('%PDF'), 'pdf should start with %PDF');
    }
    log(`exportDocument(${format}): ${stat.size} bytes -> ${outPath}`);
  }
}

function exerciseSpellcheck() {
  log('=== SymSpell ===');
  const spell = new SymSpell();
  spell.loadDefault();

  const text = 'Ths is a tset of speling.';
  const results = spell.checkText(text);
  assert(Array.isArray(results) && results.length > 0, 'checkText should find misspellings');
  log(`checkText found ${results.length} issue(s): ${results.map((r) => r.word).join(', ')}`);

  const suggestions = spell.suggest('speling');
  assert(Array.isArray(suggestions) && suggestions.length > 0, 'suggest should return corrections');
  const words = suggestions.map((s) => (typeof s === 'string' ? s : s.word));
  log(`suggest('speling'): ${words.slice(0, 3).join(', ')}`);
}

function exerciseVersion() {
  log('=== App version ===');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  assert(pkg.version === '1.2.0', `package.json version should be 1.2.0, got ${pkg.version}`);
  const { APP_VERSION } = require(path.join(ROOT, 'dist', 'shared', 'constants.js'));
  assert(APP_VERSION === '1.2.0', `APP_VERSION should be 1.2.0, got ${APP_VERSION}`);
  log(`version from package.json: ${pkg.version}`);
}

async function exerciseCustomDictionary() {
  log('=== Custom dictionary persistence ===');
  const { IPCMainRegistry } = require(path.join(ROOT, 'dist', 'main', 'ipc-registry.js'));
  const { PluginHost } = require(path.join(ROOT, 'dist', 'main', 'plugin-host.js'));
  const { ConfigStore } = require(path.join(ROOT, 'dist', 'main', 'config-store.js'));
  const { preloadCustomDictionary } = require(path.join(ROOT, 'dist', 'main', 'spell-dictionary.js'));

  const testWord = 'CognitienceXyz';
  const configStore = new ConfigStore();
  configStore.set('editor.customDictionary', [testWord]);

  const sessionWords = new Set();
  const mockSession = {
    spellChecker: {
      isMisspelled(word) {
        return !sessionWords.has(word);
      },
      getCorrectionsForMisspelling(word) {
        return sessionWords.has(word) ? [] : ['fix'];
      },
    },
    addWordToSpellCheckerDictionary(word) {
      sessionWords.add(word);
    },
  };

  const mockWindow = { webContents: { session: mockSession } };
  const mockWindowManager = {
    send() {},
    getMainWindow: () => mockWindow,
  };
  const mockExtensionHost = {
    getExtensions: () => [],
    installExtension: async () => ({}),
    uninstallExtension: async () => {},
    enableExtension: async () => {},
    disableExtension: async () => {},
    reloadExtension: async () => {},
    executeCommand: async () => null,
    getCommands: () => [],
  };

  const registry = new IPCMainRegistry(
    mockWindowManager,
    mockExtensionHost,
    configStore,
    new PluginHost(),
  );
  registry.registerAll();

  const spellCheck = mockIpcMain._handlers.get('spell:check');
  const spellCheckText = mockIpcMain._handlers.get('spell:checkText');
  const spellAddWord = mockIpcMain._handlers.get('spell:addWord');

  sessionWords.clear();
  preloadCustomDictionary(mockWindow, configStore);

  const afterRestart = await spellCheck(null, testWord);
  assert(afterRestart.correct, 'word should persist after simulated restart');

  const runtimeWord = 'RuntimeCustomWord';
  await spellAddWord(null, runtimeWord);
  const afterAdd = await spellCheck(null, runtimeWord);
  assert(afterAdd.correct, 'word should be correct after addWord');

  const text = `Hello ${testWord} and ${runtimeWord} world.`;
  const textErrors = await spellCheckText(null, text);
  const found = textErrors.some((e) => e.word === testWord || e.word === runtimeWord);
  assert(!found, 'checkText should not flag persisted custom words');
  log(`custom word "${testWord}" persists across restart`);
}

async function exerciseExtensionApi() {
  log('=== Extension command registry ===');
  const commands = new Map();

  const mockContext = {
    extensionId: 'test.publisher',
    commands: {
      registerCommand(id, handler) {
        const fullId = id.includes('.') ? id : `test.publisher.${id}`;
        commands.set(fullId, handler);
        return { dispose: () => commands.delete(fullId) };
      },
    },
    config: { get: () => 500 },
    editor: { getContent: async () => '<p>one two three four</p>' },
    documents: { onDidChange: () => ({ dispose: () => {} }) },
    statusBar: {
      createItem: () => ({
        setText: () => {},
        setTooltip: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {},
      }),
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    notifications: { info: () => {} },
    toolbar: { registerButton: () => ({ dispose: () => {} }) },
  };

  const sampleExt = require(path.join(ROOT, 'src', 'extensions', 'sample-word-count', 'index.js'));
  sampleExt.activate(mockContext);
  assert(commands.has('wordcount.show'), 'wordcount.show should be registered');
  await commands.get('wordcount.show')();
  log(`extension commands: ${[...commands.keys()].join(', ')}`);
  sampleExt.deactivate();
}

function exerciseIpcRegistry() {
  log('=== IPCMainRegistry wiring ===');
  const { IPCMainRegistry } = require(path.join(ROOT, 'dist', 'main', 'ipc-registry.js'));
  const { PluginHost } = require(path.join(ROOT, 'dist', 'main', 'plugin-host.js'));
  const { ConfigStore } = require(path.join(ROOT, 'dist', 'main', 'config-store.js'));

  const configStore = new ConfigStore();
  const pluginHost = new PluginHost();

  const mockWindowManager = {
    send(channel) { sentChannels.push(channel); },
    getMainWindow: () => null,
  };
  const mockExtensionHost = {
    getExtensions: () => [],
    installExtension: async () => ({}),
    uninstallExtension: async () => {},
    enableExtension: async () => {},
    disableExtension: async () => {},
    reloadExtension: async () => {},
    executeCommand: async () => null,
    getCommands: () => [],
  };

  const registry = new IPCMainRegistry(
    mockWindowManager,
    mockExtensionHost,
    configStore,
    pluginHost,
  );
  registry.registerAll();

  const required = [
    'doc:new', 'doc:open', 'doc:export',
    'plugin:list', 'plugin:start', 'plugin:stop', 'plugin:running',
  ];
  for (const ch of required) {
    assert(mockIpcMain._handlers.has(ch), `IPC handler missing: ${ch}`);
  }

  return mockIpcMain._handlers.get('doc:new')(null).then((res) => {
    assert(res.success, 'doc:new should return success');
    assert(sentChannels.includes('doc:new'), 'doc:new should notify renderer');
    log(`IPC handlers registered: ${required.join(', ')}`);

    return mockIpcMain._handlers.get('plugin:list')(null).then((plugins) => {
      assert(Array.isArray(plugins), 'plugin:list should return array');
      log(`plugin:list returned ${plugins.length} plugin(s)`);
    });
  });
}

async function main() {
  try {
    exerciseVersion();
    await exerciseExports();
    exerciseSpellcheck();
    await exerciseCustomDictionary();
    await exerciseExtensionApi();
    await exerciseIpcRegistry();
    log('ALL LOGIC EXERCISES PASSED');
    fs.writeFileSync(LOG_PATH, lines.join('\n') + '\n', 'utf-8');
    process.exit(0);
  } catch (err) {
    log(`FAILED: ${err.message}`);
    log(err.stack || '');
    fs.writeFileSync(LOG_PATH, lines.join('\n') + '\n', 'utf-8');
    process.exit(1);
  }
}

main();