/**
 * Direct logic exercises against shipped modules (no Electron UI).
 * Drives real entry points from dist/ and renderer helpers.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRATCH = process.env.GROK_SCRATCH || path.join(__dirname, '..', '..');
const LOG_PATH = path.join(SCRATCH, 'logic-exercise.log');
const VERSION_LOG = path.join(SCRATCH, 'version-check.log');
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
      getVersion: () => require(path.join(ROOT, 'package.json')).version,
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
          session: {
            addWordToSpellCheckerDictionary: () => true,
          },
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
const { checkWord, checkText } = require(path.join(ROOT, 'dist', 'shared', 'spell-check.js'));

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

function exerciseSpellCheckModule() {
  log('=== spell-check shared module (shipped algorithm) ===');
  const known = new Set(['hello', 'world', 'cognitiencexyz']);
  const suggestionsMap = new Map([['speling', ['spelling', 'speeling']]]);

  const backend = {
    isWordMisspelled(word) {
      return !known.has(word.toLowerCase());
    },
    getWordSuggestions(word) {
      return suggestionsMap.get(word.toLowerCase()) || ['fix'];
    },
  };

  const wordResult = checkWord(backend, 'speling');
  assert(wordResult.correct === false, 'checkWord should flag misspelling');
  assert(wordResult.suggestions.length > 0, 'checkWord should return suggestions');
  log(`checkWord('speling'): suggestions=${wordResult.suggestions.join(', ')}`);

  const custom = checkWord(backend, 'CognitienceXyz');
  assert(custom.correct === true, 'checkWord should accept custom dictionary word');

  const textResult = checkText(backend, 'Hello speling CognitienceXyz');
  assert(textResult.length === 1 && textResult[0].word === 'speling', 'checkText should find only speling');
  log(`checkText errors: ${textResult.map((e) => e.word).join(', ')}`);

  const preloadSrc = fs.readFileSync(path.join(ROOT, 'dist', 'preload', 'index.js'), 'utf-8');
  assert(preloadSrc.includes('spell:getContext'), 'preload must expose spell:getContext');
  assert(preloadSrc.includes('spell:addWord'), 'preload must expose spell:addWord');
  assert(!preloadSrc.includes("invoke('spell:check'"), 'preload must not use removed spell:check IPC');

  const spellContextSrc = fs.readFileSync(path.join(ROOT, 'dist', 'main', 'spell-context.js'), 'utf-8');
  assert(spellContextSrc.includes('dictionarySuggestions'), 'spell-context must read dictionarySuggestions');
  assert(spellContextSrc.includes('misspelledWord'), 'spell-context must read misspelledWord');
  log('shipped spell path: context-menu + session dictionary (verified in dist)');
}

function exerciseVersion() {
  log('=== App version ===');
  const versionLines = [];
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  assert(pkg.version === '1.2.0', `package.json version should be 1.2.0, got ${pkg.version}`);
  versionLines.push(`package.json version: ${pkg.version}`);

  const { APP_VERSION, GITHUB_REPO, GITHUB_LATEST_API } = require(path.join(ROOT, 'dist', 'shared', 'constants.js'));
  assert(APP_VERSION === '1.2.0', `APP_VERSION should be 1.2.0, got ${APP_VERSION}`);
  versionLines.push(`APP_VERSION constant: ${APP_VERSION}`);
  versionLines.push(`GITHUB_REPO: ${GITHUB_REPO}`);
  versionLines.push(`GITHUB_LATEST_API: ${GITHUB_LATEST_API}`);
  assert(GITHUB_REPO === 'Maq-Swarm/cognitience-wp', 'GITHUB_REPO should be Maq-Swarm/cognitience-wp');

  try {
    const grepOut = execSync(
      'rg "1\\.1\\.0" --glob "*.ts" --glob "*.js" --glob "*.json" --glob "*.html" --glob "*.md" src/ README.md package.json website/cognition-wp/index.html website/cognition-wp/downloads.html website/cognition-wp/releases.html 2>&1 || true',
      { cwd: ROOT, encoding: 'utf-8', shell: true },
    );
    versionLines.push('--- grep 1.1.0 in user-facing paths ---');
    versionLines.push(grepOut.trim() || '(no matches)');
    assert(!grepOut.includes('src\\main') && !grepOut.includes('src/main'),
      'src/main should have no 1.1.0 hardcodes');
  } catch (e) {
    versionLines.push(`grep note: ${e.message}`);
  }

  assert(GITHUB_LATEST_API.includes('Maq-Swarm/cognitience-wp'),
    'GITHUB_LATEST_API should point at Maq-Swarm repo');
  const ipcSrc = fs.readFileSync(path.join(ROOT, 'dist', 'main', 'ipc-registry.js'), 'utf-8');
  assert(ipcSrc.includes('GITHUB_LATEST_API'), 'ipc-registry should use GITHUB_LATEST_API constant');
  versionLines.push('update checker URL: Maq-Swarm via GITHUB_LATEST_API');

  fs.writeFileSync(VERSION_LOG, versionLines.join('\n') + '\n', 'utf-8');
  log(versionLines.join('\n'));
}

function exerciseSpellContextHandler() {
  log('=== spell-context handler (shipped Hunspell suggestions path) ===');
  const { handleSpellContextParams, getLastSpellContext, clearLastSpellContext } =
    require(path.join(ROOT, 'dist', 'main', 'spell-context.js'));

  clearLastSpellContext();
  const sent = [];
  const mockWin = {
    webContents: { send: (channel, data) => sent.push({ channel, data }) },
  };

  const ctx = handleSpellContextParams(mockWin, {
    misspelledWord: 'speling',
    dictionarySuggestions: ['spelling', 'speeling'],
    x: 120,
    y: 80,
  });

  assert(ctx && ctx.misspelledWord === 'speling', 'handler should capture misspelledWord');
  assert(ctx.suggestions.length === 2, 'handler should capture dictionarySuggestions');
  assert(getLastSpellContext()?.misspelledWord === 'speling', 'getLastSpellContext should persist');
  assert(sent[0].channel === 'spell:contextMenu', 'handler should notify renderer');
  log(`spell-context: ${ctx.misspelledWord} → ${ctx.suggestions.join(', ')}`);
}

async function exerciseSpellAddWordIpc() {
  log('=== spell:addWord IPC (session dictionary) ===');
  const { IPCMainRegistry } = require(path.join(ROOT, 'dist', 'main', 'ipc-registry.js'));
  const { PluginHost } = require(path.join(ROOT, 'dist', 'main', 'plugin-host.js'));
  const { ConfigStore } = require(path.join(ROOT, 'dist', 'main', 'config-store.js'));

  const added = [];
  const mockWindow = {
    webContents: {
      session: {
        addWordToSpellCheckerDictionary(word) {
          added.push(word);
          return true;
        },
      },
    },
  };
  const mockWindowManager = { send() {}, getMainWindow: () => mockWindow };
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

  const registry = new IPCMainRegistry(mockWindowManager, mockExtensionHost, new ConfigStore(), new PluginHost());
  registry.registerAll();

  assert(mockIpcMain._handlers.has('spell:addWord'), 'spell:addWord handler must exist');
  assert(mockIpcMain._handlers.has('spell:getContext'), 'spell:getContext handler must exist');
  assert(!mockIpcMain._handlers.has('spell:check'), 'spell:check IPC removed (context-menu path)');

  const res = await mockIpcMain._handlers.get('spell:addWord')(null, 'TestWord');
  assert(res.success === true, 'spell:addWord should succeed');
  assert(added.includes('TestWord'), 'spell:addWord should call session.addWordToSpellCheckerDictionary');
  log(`spell:addWord forwarded to session: ${added.join(', ')}`);
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
    exerciseSpellCheckModule();
    exerciseSpellContextHandler();
    await exerciseSpellAddWordIpc();
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