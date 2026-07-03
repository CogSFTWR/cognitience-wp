/**
 * Direct logic exercises against shipped modules (no Electron UI).
 * Drives real entry points from dist/ and renderer helpers.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRATCH = process.env.GROK_SCRATCH
  || path.join(require('os').tmpdir(), 'grok-goal-8cbdee8c2cc6', 'implementer');
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

function exerciseSpellReplace() {
  log('=== Spell replace (pure DOM unit) ===');
  const { JSDOM } = require('jsdom');
  const { replaceMisspelledWord } = require(path.join(ROOT, 'dist', 'renderer', 'spell-replace.js'));

  const dom = new JSDOM('<!DOCTYPE html><body><div id="ed" contenteditable>speling test</div></body>', {
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const { document } = window;
  global.window = window;
  global.document = document;
  global.Range = window.Range;
  global.NodeFilter = window.NodeFilter;

  const editor = document.getElementById('ed');
  const range = document.createRange();
  range.setStart(editor.firstChild, 0);
  range.setEnd(editor.firstChild, 6);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const ok = replaceMisspelledWord(editor, 'speling', 'spelling');
  assert(ok, 'replaceMisspelledWord should return true');
  assert(editor.textContent === 'spelling test', `expected "spelling test", got "${editor.textContent}"`);
  log('replaceMisspelledWord: speling → spelling test');
}

function exerciseSpellShippedStructure() {
  log('=== Spell shipped structure (manual SymSpell + underline on demand) ===');

  const indexSrc = fs.readFileSync(path.join(ROOT, 'dist', 'main', 'index.js'), 'utf-8');
  const ipcPos = indexSrc.indexOf('registerAll()');
  const winPos = indexSrc.indexOf('createMainWindow()');
  assert(ipcPos !== -1 && winPos !== -1 && ipcPos < winPos,
    'IPC registerAll must run before createMainWindow in shipped main');
  assert(indexSrc.includes('setSpellCheckerEnabled(false)'),
    'main must keep native session spellcheck disabled');

  const rendererSrc = fs.readFileSync(path.join(ROOT, 'dist', 'renderer', 'renderer.js'), 'utf-8');
  assert(rendererSrc.includes('runDocumentSpellcheck'), 'renderer must expose manual spellcheck runner');
  assert(rendererSrc.includes('btn-spellcheck'), 'renderer must wire Spellcheck toolbar button');
  assert(rendererSrc.includes('cog-misspelled'), 'renderer must use cog-misspelled underline class');
  assert(rendererSrc.includes('replaceMisspelledWord'), 'renderer applySpellingFix must use replaceMisspelledWord');
  assert(!rendererSrc.includes('spell.waitForContext'), 'renderer must not use native waitForContext spell path');

  assert(fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'spell-replace.js')),
    'spell-replace.js must be copied to dist/renderer');
  assert(fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'spell-manual.js')),
    'spell-manual.js must be copied to dist/renderer');
  assert(fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'spellsolver.js')),
    'spellsolver.js must be copied to dist/renderer');

  const spellIpcSrc = fs.readFileSync(path.join(ROOT, 'dist', 'main', 'spell-ipc.js'), 'utf-8');
  assert(spellIpcSrc.includes('spell:getContext'), 'spell-ipc must register spell:getContext');
  assert(spellIpcSrc.includes('addWordToSpellCheckerDictionary'), 'spell-ipc must use session dictionary API');
  assert(!fs.existsSync(path.join(ROOT, 'dist', 'shared', 'spell-check.js')),
    'unused spell-check module must not be in dist');
  log('manual spellcheck structure verified in dist');
}

function exerciseVersion() {
  log('=== App version ===');
  const versionLines = [];
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  assert(pkg.version === '1.2.2', `package.json version should be 1.2.2, got ${pkg.version}`);
  versionLines.push(`package.json version: ${pkg.version}`);

  const { APP_VERSION, APP_PUBLISHER, GITHUB_REPO, GITHUB_LATEST_API } =
    require(path.join(ROOT, 'dist', 'shared', 'constants.js'));
  assert(APP_VERSION === '1.2.2', `APP_VERSION should be 1.2.2, got ${APP_VERSION}`);
  assert(APP_PUBLISHER === 'Maq-Swarm', `APP_PUBLISHER should be Maq-Swarm, got ${APP_PUBLISHER}`);
  assert(pkg.author === 'Maq-Swarm', `package.json author should be Maq-Swarm, got ${pkg.author}`);
  assert(pkg.build && pkg.build.appId === 'com.maqswarm.cognitiencewp',
    `build.appId should be com.maqswarm.cognitiencewp, got ${pkg.build && pkg.build.appId}`);
  versionLines.push(`build.appId: ${pkg.build.appId}`);
  versionLines.push(`APP_VERSION constant: ${APP_VERSION}`);
  versionLines.push(`APP_PUBLISHER: ${APP_PUBLISHER}`);
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

function exerciseBuiltAppId() {
  const unpackedPkg = path.join(ROOT, 'release', 'win-unpacked', 'resources', 'app.asar');
  const loosePkg = path.join(ROOT, 'release', 'win-unpacked', 'resources', 'app', 'package.json');
  log('=== Built appId (win-unpacked) ===');
  if (fs.existsSync(loosePkg)) {
    const built = JSON.parse(fs.readFileSync(loosePkg, 'utf-8'));
    assert(built.build && built.build.appId === 'com.maqswarm.cognitiencewp',
      `built package.json appId should be com.maqswarm.cognitiencewp, got ${built.build && built.build.appId}`);
    log(`loose package.json appId: ${built.build.appId}`);
    return;
  }
  if (fs.existsSync(unpackedPkg)) {
    const { execSync } = require('child_process');
    const extractDir = path.join(SCRATCH, 'asar-extract');
    fs.rmSync(extractDir, { recursive: true, force: true });
    execSync(`npx --yes @electron/asar extract "${unpackedPkg}" "${extractDir}"`, {
      cwd: ROOT,
      stdio: 'pipe',
      shell: true,
    });
    const built = JSON.parse(fs.readFileSync(path.join(extractDir, 'package.json'), 'utf-8'));
    const builtJson = JSON.stringify(built);
    assert(!builtJson.includes('wailonbrowngh'), 'built package.json must not contain wailonbrowngh');
    assert(built.version === '1.2.2', `built version should be 1.2.2, got ${built.version}`);
    assert(built.author === 'Maq-Swarm', `built author should be Maq-Swarm, got ${built.author}`);
    assert(built.cognitienceAppId === 'com.maqswarm.cognitiencewp',
      `asar cognitienceAppId should be com.maqswarm.cognitiencewp, got ${built.cognitienceAppId}`);
    const updateYml = path.join(ROOT, 'release', 'win-unpacked', 'resources', 'app-update.yml');
    if (fs.existsSync(updateYml)) {
      const yml = fs.readFileSync(updateYml, 'utf-8');
      assert(yml.includes('owner: Maq-Swarm'), 'app-update.yml owner should be Maq-Swarm');
      log('app-update.yml owner: Maq-Swarm');
    }
    log(`asar cognitienceAppId: ${built.cognitienceAppId}, author: ${built.author}`);
    return;
  }
  log('(skip: release/win-unpacked not present — run package:win first)');
}

async function main() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  try {
    exerciseVersion();
    await exerciseExports();
    exerciseSpellReplace();
    exerciseSpellShippedStructure();
    exerciseBuiltAppId();
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