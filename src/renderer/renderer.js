/**
 * Cognitience WP — Renderer Application
 * The main renderer process: editor, UI, command palette, extension integration.
 */

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════

const CognitienceWP = {
  editor: null,
  docTitle: 'Untitled',
  docPath: null,
  docFormat: 'rich',
  isDirty: false,
  wordCount: 0,
  charCount: 0,
  currentTheme: 'cognitience-light',
  config: {},
  commands: [],
  sidebarVisible: true,
  rightPanelVisible: false,
  focusMode: false,
  zoomLevel: 0,
  statusBarItems: [],
  extensions: [],
  recentFiles: [],
  findState: { query: '', index: -1, matches: 0 },
  // Spellcheck
  spellChecker: null,
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function confirmDiscardIfDirty() {
  if (!CognitienceWP.isDirty) return true;
  if (CognitienceWP.config['files.hotExit'] === false) return true;
  return confirm('Discard unsaved changes?');
}

// ═══════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════

async function init() {
  CognitienceWP.editor = document.getElementById('editor-page');

  if (window.cognitience.platform === 'darwin') {
    document.body.classList.add('platform-darwin');
  }

  // Load config
  try {
    CognitienceWP.config = await window.cognitience.config.getAll();
  } catch (e) {
    console.warn('Could not load config, using defaults', e);
  }

  // Apply theme
  const savedTheme = await window.cognitience.theme.get();
  if (savedTheme) {
    applyTheme(savedTheme);
  }

  // Apply config to editor
  applyConfigToEditor();

  // Setup all event listeners
  setupEditorEvents();
  setupToolbar();
  setupWindowControls();
  setupKeyboardShortcuts();
  setupCommandPalette();
  setupFindReplace();
  setupStatusBar();
  setupMenuListeners();
  setupThemeListener();
  setupConfigListener();
  setupExtensionListeners();

  // Initialize spellchecker
  initSpellChecker();

  // Load extensions
  try {
    CognitienceWP.extensions = await window.cognitience.extensions.list();
    console.log(`[Cognitience WP] Loaded ${CognitienceWP.extensions.length} extension(s)`);
  } catch (e) {
    console.warn('Could not load extensions', e);
  }

  // Update word count
  updateWordCount();

  // Show sidebar with explorer
  showSidebarView('explorer');

  console.log('[Cognitience WP] Renderer initialized.');
}

// ═══════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════

function applyTheme(themeId) {
  document.documentElement.setAttribute('data-theme', themeId);
  CognitienceWP.currentTheme = themeId;
  const themeLabels = {
    'cognitience-dark': 'Cognitience Dark',
    'cognitience-light': 'Cognitience Light',
    'cognitience-sepia': 'Cognitience Sepia',
    'cognitience-contrast-dark': 'High Contrast Dark',
  };
  const label = document.getElementById('status-theme');
  if (label) label.textContent = themeLabels[themeId] || themeId;
}

function setupThemeListener() {
  window.cognitience.theme.onChanged((themeId) => {
    applyTheme(themeId);
  });
}

// ═══════════════════════════════════════════════════════════
// CONFIG APPLICATION
// ═══════════════════════════════════════════════════════════

function applyConfigToEditor() {
  const cfg = CognitienceWP.config;
  const root = document.documentElement;

  if (cfg['editor.fontSize']) {
    root.style.setProperty('--editor-font-size', cfg['editor.fontSize'] + 'px');
  }
  if (cfg['editor.fontFamily']) {
    root.style.setProperty('--editor-font-family', cfg['editor.fontFamily']);
  }
  if (cfg['editor.lineHeight']) {
    root.style.setProperty('--editor-line-height', String(cfg['editor.lineHeight']));
  }
  if (cfg['editor.maxLineWidth']) {
    root.style.setProperty('--editor-max-width', cfg['editor.maxLineWidth'] + 'px');
  }
  if (cfg['editor.padding']) {
    root.style.setProperty('--editor-padding', cfg['editor.padding'] + 'px');
  }

  if (CognitienceWP.editor) {
    CognitienceWP.editor.setAttribute('spellcheck', 'false');
    CognitienceWP.editor.spellcheck = false;
  }
}

function setupConfigListener() {
  window.cognitience.config.onChanged((key, value) => {
    CognitienceWP.config[key] = value;
    applyConfigToEditor();
  });
}

// ═══════════════════════════════════════════════════════════
// EDITOR EVENTS
// ═══════════════════════════════════════════════════════════

function setupEditorEvents() {
  const editor = CognitienceWP.editor;

  editor.spellcheck = false;
  editor.setAttribute('spellcheck', 'false');

  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '    ');
    }
  }, true);

  editor.addEventListener('input', () => {
    if (window.SpellManual) {
      window.SpellManual.clearMisspelledMarks(editor);
    }
    markDirty();
    updateWordCount();
    updateOutline();
    scheduleAutoSave();
  });

  editor.addEventListener('keyup', () => {
    updateCursorPosition();
    updateToolbarState();
  });

  editor.addEventListener('click', updateCursorPosition);
  editor.addEventListener('mouseup', updateToolbarState);

  editor.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const missSpan = e.target.closest && e.target.closest('.cog-misspelled');
    const sel = window.getSelection();
    const savedRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    let spellCtx = null;
    if (missSpan && CognitienceWP.spellChecker) {
      const word = missSpan.dataset.word || missSpan.textContent;
      const suggestions = CognitienceWP.spellChecker.suggest(String(word).toLowerCase(), 5).map((s) => s.word);
      lastSpellContextForFix = {
        misspelledWord: word,
        suggestions,
        x: e.clientX,
        y: e.clientY,
        savedRange,
      };
      spellCtx = { misspelledWord: word, suggestions };
    } else {
      lastSpellContextForFix = null;
    }
    showContextMenu(e.clientX, e.clientY, spellCtx);
  });

  // Debounced auto-save on editor input
  let autoSaveTimer = null;
  function scheduleAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      if (CognitienceWP.config['editor.autoSave'] && CognitienceWP.isDirty && CognitienceWP.docPath) {
        saveDocument();
      }
    }, CognitienceWP.config['editor.autoSaveDelay'] || 1000);
  }
}

function markDirty() {
  if (!CognitienceWP.isDirty) {
    CognitienceWP.isDirty = true;
    updateTitle();
    const saveState = document.getElementById('status-save-state');
    if (saveState) saveState.textContent = '● Unsaved';
  }
}

function markClean() {
  CognitienceWP.isDirty = false;
  updateTitle();
  const saveState = document.getElementById('status-save-state');
  if (saveState) saveState.textContent = '';
}

function updateTitle() {
  const titleEl = document.getElementById('doc-title');
  if (titleEl) {
    const dirty = CognitienceWP.isDirty ? '● ' : '';
    titleEl.textContent = `${dirty}${CognitienceWP.docTitle} — Cognitience WP`;
  }
}

// ═══════════════════════════════════════════════════════════
// WORD COUNT & CURSOR POSITION
// ═══════════════════════════════════════════════════════════

function updateWordCount() {
  const text = CognitienceWP.editor.innerText || '';
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  CognitienceWP.wordCount = words.length;
  CognitienceWP.charCount = text.length;

  const wcEl = document.getElementById('status-word-count');
  const ccEl = document.getElementById('status-char-count');
  if (wcEl) wcEl.textContent = `${CognitienceWP.wordCount} words`;
  if (ccEl) ccEl.textContent = `${CognitienceWP.charCount} chars`;

  // Reading time
  const readingTime = Math.max(1, Math.ceil(CognitienceWP.wordCount / 200));
  const docInfo = document.getElementById('status-doc-info');
  if (docInfo) {
    docInfo.textContent = `~${readingTime} min read`;
  }
}

function updateCursorPosition() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  const range = sel.getRangeAt(0);
  const preRange = document.createRange();
  preRange.selectNodeContents(CognitienceWP.editor);
  preRange.setEnd(range.startContainer, range.startOffset);

  const text = preRange.toString();
  const lines = text.split('\n');
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;

  const cursorEl = document.getElementById('status-selection');
  if (cursorEl) cursorEl.textContent = `Ln ${line}, Col ${col}`;
}

// ═══════════════════════════════════════════════════════════
// TOOLBAR
// ═══════════════════════════════════════════════════════════

function setupToolbar() {
  const spellBtn = document.getElementById('btn-spellcheck');
  if (spellBtn) {
    spellBtn.addEventListener('click', () => runDocumentSpellcheck());
  }

  const buttons = document.querySelectorAll('.tool-btn[data-cmd]');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      executeFormatCommand(btn.getAttribute('data-cmd'));
    });
  });

  // Heading select
  const headingSelect = document.getElementById('heading-select');
  if (headingSelect) {
    headingSelect.addEventListener('change', () => {
      const tag = headingSelect.value;
      if (tag === 'p') {
        document.execCommand('formatBlock', false, 'P');
      } else if (tag === 'pre') {
        document.execCommand('formatBlock', false, 'PRE');
      } else if (tag === 'blockquote') {
        document.execCommand('formatBlock', false, 'BLOCKQUOTE');
      } else {
        document.execCommand('formatBlock', false, tag.toUpperCase());
      }
      CognitienceWP.editor.focus();
    });
  }

  // Font size input (6-120 px, custom CSS-based)
  const fontSizeInput = document.getElementById('font-size-input');
  if (fontSizeInput) {
    fontSizeInput.addEventListener('change', () => {
      const size = parseInt(fontSizeInput.value);
      if (isNaN(size) || size < 6 || size > 120) return;
      // Use execCommand to wrap selection in a span with the font size
      document.execCommand('fontSize', false, '7');
      // Now find the font[size="7"] elements and replace with CSS
      const fontElements = CognitienceWP.editor.querySelectorAll('font[size="7"]');
      fontElements.forEach(el => {
        el.removeAttribute('size');
        el.style.fontSize = size + 'px';
      });
      CognitienceWP.editor.focus();
    });
  }

  // Text color - button triggers hidden color input
  const textColorBtn = document.getElementById('text-color-btn');
  const textColor = document.getElementById('text-color');
  const textColorBar = document.getElementById('text-color-bar');
  if (textColorBtn && textColor) {
    textColorBtn.addEventListener('click', () => textColor.click());
    textColor.addEventListener('change', () => {
      document.execCommand('foreColor', false, textColor.value);
      if (textColorBar) textColorBar.style.background = textColor.value;
      CognitienceWP.editor.focus();
    });
  }

  // Background/highlight color - button triggers hidden color input
  const bgColorBtn = document.getElementById('bg-color-btn');
  const bgColor = document.getElementById('bg-color');
  const bgColorBar = document.getElementById('bg-color-bar');
  if (bgColorBtn && bgColor) {
    bgColorBtn.addEventListener('click', () => bgColor.click());
    bgColor.addEventListener('change', () => {
      document.execCommand('hiliteColor', false, bgColor.value);
      if (bgColorBar) bgColorBar.style.background = bgColor.value;
      CognitienceWP.editor.focus();
    });
  }
}

function executeFormatCommand(cmd) {
  CognitienceWP.editor.focus();

  switch (cmd) {
    case 'bold':
      document.execCommand('bold');
      break;
    case 'italic':
      document.execCommand('italic');
      break;
    case 'underline':
      document.execCommand('underline');
      break;
    case 'strikethrough':
      document.execCommand('strikeThrough');
      break;
    case 'subscript':
      document.execCommand('subscript');
      break;
    case 'superscript':
      document.execCommand('superscript');
      break;
    case 'removeFormat':
      document.execCommand('removeFormat');
      break;
    case 'insertUnorderedList':
      document.execCommand('insertUnorderedList');
      break;
    case 'insertOrderedList':
      document.execCommand('insertOrderedList');
      break;
    case 'insertCheckbox':
      toggleChecklistItem();
      break;
    case 'createLink':
      showLinkDialog();
      break;
    case 'insertImage':
      showImageDialog();
      break;
    case 'insertTable':
      showTableDialog();
      break;
    case 'insertHR':
      document.execCommand('insertHorizontalRule');
      break;
    case 'align-left':
      document.execCommand('justifyLeft');
      break;
    case 'align-center':
      document.execCommand('justifyCenter');
      break;
    case 'align-right':
      document.execCommand('justifyRight');
      break;
    case 'align-justify':
      document.execCommand('justifyFull');
      break;
    case 'undo':
      document.execCommand('undo');
      break;
    case 'redo':
      document.execCommand('redo');
      break;
  }

  updateToolbarState();
}

function toggleChecklistItem() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let node = sel.anchorNode;
  while (node && node !== CognitienceWP.editor) {
    if (node.classList && node.classList.contains('checklist')) {
      // Toggle the current list item
      let li = node;
      while (li && li.tagName !== 'LI') li = li.parentNode;
      if (li) li.classList.toggle('checked');
      return;
    }
    node = node.parentNode;
  }
  // Create a new checklist
  document.execCommand('insertHTML', false,
    '<ul class="checklist"><li>New task</li></ul><p></p>');
}

// ═══════════════════════════════════════════════════════════
// TEMPLATES (sidebar rendering)
// ═══════════════════════════════════════════════════════════

function renderTemplates(container) {
  const templates = window.COGNITIENCE_TEMPLATES || {};
  const icons = {
    arxiv: 'paper', outline: 'list', email: 'envelope', book: 'book', blank: 'file'
  };
  const iconSvgs = {
    paper: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>',
    list: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    envelope: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    book: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    file: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
  };

  let html = '<div style="padding:8px 12px;">';
  html += '<div class="sidebar-section-header" style="margin-bottom:8px;">Available Templates</div>';
  for (const [key, tmpl] of Object.entries(templates)) {
    const icon = iconSvgs[tmpl.icon] || iconSvgs.file;
    html += `
      <div class="template-card" onclick="insertTemplate('${escapeHtml(key)}')">
        <div class="template-card-icon">${icon}</div>
        <div>
          <div class="template-card-name">${escapeHtml(tmpl.name)}</div>
          <div class="template-card-desc">${escapeHtml(tmpl.description)}</div>
        </div>
      </div>`;
  }
  html += '</div>';
  container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// UPDATE CHECKING
// ═══════════════════════════════════════════════════════════

async function checkForUpdates() {
  showNotification('info', 'Updates', 'Checking for updates...');
  try {
    const result = await window.cognitience.updates.check();
    if (result.error) {
      showNotification('warning', 'Update Check', 'Could not check for updates. Visit Settings to download manually.');
      return;
    }
    if (result.updateAvailable) {
      showNotification('info', 'Update Available',
        `Version ${result.latestVersion} is available (current: ${result.currentVersion}). Click to download.`);
      // In a full implementation, we'd show a dialog with release notes and download button
      if (confirm(`Version ${result.latestVersion} is available!\n\nCurrent: ${result.currentVersion}\nLatest: ${result.latestVersion}\n\nWould you like to download the update?`)) {
        window.cognitience.updates.downloadAndInstall(result.downloadUrl);
      }
    } else {
      showNotification('success', 'Up to Date',
        `You're running the latest version (${result.currentVersion}).`);
    }
  } catch (e) {
    showNotification('warning', 'Update Check',
      'Could not check for updates. Visit GitHub releases page manually.');
  }
}

function showLinkDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">Insert Link</div>
      <input type="text" id="modal-link-url" class="modal-input" placeholder="https://..." />
      <input type="text" id="modal-link-text" class="modal-input" placeholder="Link text (optional)" />
      <div class="modal-buttons">
        <button class="panel-btn" id="modal-cancel">Cancel</button>
        <button class="panel-btn primary" id="modal-ok">Insert</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const urlInput = overlay.querySelector('#modal-link-url');
  urlInput.focus();
  overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());
  const submit = () => {
    const url = urlInput.value.trim();
    const text = overlay.querySelector('#modal-link-text').value.trim();
    if (url) {
      CognitienceWP.editor.focus();
      if (text) {
        document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`);
      } else {
        document.execCommand('createLink', false, url);
      }
    }
    overlay.remove();
  };
  overlay.querySelector('#modal-ok').addEventListener('click', submit);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function showImageDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">Insert Image</div>
      <input type="text" id="modal-img-url" class="modal-input" placeholder="Image URL or file path" />
      <input type="text" id="modal-img-alt" class="modal-input" placeholder="Alt text (optional)" />
      <div class="modal-buttons">
        <button class="panel-btn" id="modal-cancel">Cancel</button>
        <button class="panel-btn" id="modal-browse">Browse...</button>
        <button class="panel-btn primary" id="modal-ok">Insert</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const urlInput = overlay.querySelector('#modal-img-url');
  urlInput.focus();
  overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#modal-browse').addEventListener('click', async () => {
    const result = await window.cognitience.fs.browseImage();
    if (result) urlInput.value = result;
  });
  const submit = () => {
    const url = urlInput.value.trim();
    const alt = overlay.querySelector('#modal-img-alt').value.trim();
    if (url) {
      CognitienceWP.editor.focus();
      document.execCommand('insertHTML', false, `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;" />`);
    }
    overlay.remove();
  };
  overlay.querySelector('#modal-ok').addEventListener('click', submit);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function showTableDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">Insert Table</div>
      <div style="display:flex;gap:12px;">
        <label class="modal-label">Rows: <input type="number" id="modal-rows" class="modal-input" value="3" min="1" max="50" style="width:60px;" /></label>
        <label class="modal-label">Cols: <input type="number" id="modal-cols" class="modal-input" value="3" min="1" max="20" style="width:60px;" /></label>
      </div>
      <div class="modal-buttons">
        <button class="panel-btn" id="modal-cancel">Cancel</button>
        <button class="panel-btn primary" id="modal-ok">Insert</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#modal-rows').focus();
  overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#modal-ok').addEventListener('click', () => {
    const rows = parseInt(overlay.querySelector('#modal-rows').value) || 3;
    const cols = parseInt(overlay.querySelector('#modal-cols').value) || 3;
    let html = '<table><thead><tr>';
    for (let c = 0; c < cols; c++) html += `<th>Header ${c + 1}</th>`;
    html += '</tr></thead><tbody>';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) html += '<td></td>';
      html += '</tr>';
    }
    html += '</tbody></table><p></p>';
    CognitienceWP.editor.focus();
    document.execCommand('insertHTML', false, html);
    overlay.remove();
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function updateToolbarState() {
  const buttons = document.querySelectorAll('.tool-btn');
  buttons.forEach(btn => {
    const cmd = btn.getAttribute('data-cmd');
    let active = false;
    switch (cmd) {
      case 'bold': active = document.queryCommandState('bold'); break;
      case 'italic': active = document.queryCommandState('italic'); break;
      case 'underline': active = document.queryCommandState('underline'); break;
      case 'strikethrough': active = document.queryCommandState('strikeThrough'); break;
      case 'subscript': active = document.queryCommandState('subscript'); break;
      case 'superscript': active = document.queryCommandState('superscript'); break;
      case 'align-left': active = document.queryCommandState('justifyLeft'); break;
      case 'align-center': active = document.queryCommandState('justifyCenter'); break;
      case 'align-right': active = document.queryCommandState('justifyRight'); break;
      case 'align-justify': active = document.queryCommandState('justifyFull'); break;
    }
    btn.classList.toggle('active', active);
  });

  // Update heading select
  const headingSelect = document.getElementById('heading-select');
  if (headingSelect) {
    const block = document.queryCommandValue('formatBlock').toLowerCase();
    const mapping = { 'h1': 'h1', 'h2': 'h2', 'h3': 'h3', 'h4': 'h4', 'h5': 'h5', 'h6': 'h6', 'pre': 'pre', 'blockquote': 'blockquote' };
    headingSelect.value = mapping[block] || 'p';
  }
}

// ═══════════════════════════════════════════════════════════
// WINDOW CONTROLS
// ═══════════════════════════════════════════════════════════

function setupWindowControls() {
  document.getElementById('btn-close').addEventListener('click', () => {
    if (confirmDiscardIfDirty()) {
      window.cognitience.window.close();
    }
  });
  document.getElementById('btn-minimize').addEventListener('click', () => {
    window.cognitience.window.minimize();
  });
  document.getElementById('btn-maximize').addEventListener('click', () => {
    window.cognitience.window.maximize();
  });
  document.getElementById('btn-command-palette').addEventListener('click', () => {
    openCommandPalette();
  });
  // Toolbar toggle buttons
  const toggleSidebarBtn = document.getElementById('btn-toggle-sidebar');
  if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', () => toggleSidebar());
  }
  const focusModeBtn = document.getElementById('btn-focus-mode');
  if (focusModeBtn) {
    focusModeBtn.addEventListener('click', () => toggleFocusMode());
  }
}

// ═══════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════

function showSidebarView(view) {
  const sidebar = document.getElementById('sidebar');
  const title = document.getElementById('sidebar-title');
  const content = document.getElementById('sidebar-content');

  sidebar.classList.remove('hidden');
  CognitienceWP.sidebarVisible = true;

  switch (view) {
    case 'explorer':
      title.textContent = 'Explorer';
      renderExplorer(content);
      break;
    case 'search':
      title.textContent = 'Search';
      renderSearch(content);
      break;
    case 'outline':
      title.textContent = 'Outline';
      renderOutline(content);
      break;
    case 'extensions':
      title.textContent = 'Extensions';
      renderExtensions(content);
      break;
    case 'settings':
      title.textContent = 'Settings';
      renderSettings(content);
      break;
    case 'templates':
      title.textContent = 'Templates';
      renderTemplates(content);
      break;
    case 'docs':
      title.textContent = 'Plugin Documentation';
      renderPluginDocs(content);
      break;
  }
}

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

const EXPLORER_ACTIONS = {
  'focus-editor': () => CognitienceWP.editor.focus(),
  'new-document': () => newDocument(),
  'open-document': () => openDocument(),
  'save-document': () => saveDocument(),
  'save-as': () => saveAsDocument(),
};

function wireExplorerActions(container) {
  container.querySelectorAll('[data-action]').forEach((item) => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      if (action === 'open-recent') {
        const filePath = item.dataset.path;
        if (filePath) openRecentFile(filePath);
        return;
      }
      const handler = EXPLORER_ACTIONS[action];
      if (handler) handler();
    });
  });
}

function renderExplorer(container) {
  container.innerHTML = `
    <div class="sidebar-section">
      <div class="sidebar-section-header">Open Document</div>
      <div class="sidebar-item" data-action="focus-editor">
        <span class="sidebar-icon">📄</span>
        <span class="sidebar-name">${CognitienceWP.docTitle}</span>
      </div>
    </div>
    <div class="sidebar-section">
      <div class="sidebar-section-header">Recent Files</div>
      ${CognitienceWP.recentFiles.length > 0
        ? CognitienceWP.recentFiles.map(f => `
          <div class="sidebar-item" data-action="open-recent" data-path="${escapeHtmlAttr(f.path)}">
            <span class="sidebar-icon">📃</span>
            <span class="sidebar-name">${f.name}</span>
          </div>
        `).join('')
        : '<div class="sidebar-item" style="opacity:0.5"><span class="sidebar-name">No recent files</span></div>'
      }
    </div>
    <div class="sidebar-section">
      <div class="sidebar-section-header">Actions</div>
      <div class="sidebar-item" data-action="new-document">
        <span class="sidebar-icon">✨</span>
        <span class="sidebar-name">New Document (Ctrl+N)</span>
      </div>
      <div class="sidebar-item" data-action="open-document">
        <span class="sidebar-icon">📂</span>
        <span class="sidebar-name">Open File… (Ctrl+O)</span>
      </div>
      <div class="sidebar-item" data-action="save-document">
        <span class="sidebar-icon">💾</span>
        <span class="sidebar-name">Save (Ctrl+S)</span>
      </div>
      <div class="sidebar-item" data-action="save-as">
        <span class="sidebar-icon">📥</span>
        <span class="sidebar-name">Save As… (Ctrl+Shift+S)</span>
      </div>
    </div>
  `;
  wireExplorerActions(container);
}

function renderSearch(container) {
  container.innerHTML = `
    <div class="search-container">
      <div class="search-input-wrapper">
        <input type="text" class="search-input" id="sidebar-search" placeholder="Search in document…" />
        <button class="panel-btn" id="sidebar-search-btn">Find</button>
      </div>
      <input type="text" class="search-replace-input" id="sidebar-replace" placeholder="Replace with…" />
      <div style="display:flex;gap:4px;margin-bottom:8px;">
        <button class="panel-btn" id="sidebar-replace-btn">Replace</button>
        <button class="panel-btn" id="sidebar-replace-all-btn">Replace All</button>
      </div>
      <div id="search-results"></div>
    </div>
  `;

  const searchInput = document.getElementById('sidebar-search');
  const searchBtn = document.getElementById('sidebar-search-btn');
  searchBtn.addEventListener('click', () => performSearch(searchInput.value));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch(searchInput.value);
  });
}

function renderOutline(container) {
  const headings = CognitienceWP.editor.querySelectorAll('h1, h2, h3, h4, h5, h6');
  container.innerHTML = '';
  if (headings.length === 0) {
    container.innerHTML = '<div style="padding:8px 12px;color:var(--fg-tab);font-size:13px;">No headings found. Add headings (Ctrl+1, Ctrl+2, etc.) to create an outline.</div>';
    return;
  }
  headings.forEach((h, i) => {
    const level = h.tagName.toLowerCase();
    const item = document.createElement('div');
    item.className = `outline-item ${level}`;
    item.textContent = h.textContent || '(empty heading)';
    item.addEventListener('click', () => {
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      h.style.background = 'var(--bg-active)';
      setTimeout(() => h.style.background = '', 1000);
    });
    container.appendChild(item);
  });
}

function renderExtensions(container) {
  const exts = CognitienceWP.extensions;
  container.innerHTML = `
    <div style="padding:8px 12px;">
      <input type="text" class="search-input" id="ext-search" placeholder="Search extensions…" style="width:100%;margin-bottom:8px;" />
    </div>
    ${exts.length > 0
      ? exts.map(ext => `
        <div class="extension-card" data-ext-id="${ext.id}">
          <div class="extension-icon">🔌</div>
          <div class="extension-info">
            <div class="extension-name">${ext.manifest.displayName || ext.manifest.name}</div>
            <div class="extension-publisher">${ext.manifest.publisher} • v${ext.manifest.version}</div>
            <div class="extension-description">${ext.manifest.description || ''}</div>
            <div class="extension-actions">
              <button class="extension-action-btn" onclick="toggleExtension('${ext.id}')">${ext.state === 'active' ? 'Disable' : 'Enable'}</button>
              <button class="extension-action-btn" onclick="reloadExtension('${ext.id}')">Reload</button>
              <button class="extension-action-btn" onclick="uninstallExtension('${ext.id}')">Uninstall</button>
            </div>
          </div>
        </div>
      `).join('')
      : '<div style="padding:16px;text-align:center;color:var(--fg-tab);font-size:13px;">No extensions installed. Click Extensions → Install from VSIX… in the menu.</div>'
    }
  `;
}

function renderSettings(container) {
  const cfg = CognitienceWP.config;
  container.innerHTML = `
    <div class="settings-container">
      <div class="settings-group">
        <div class="settings-group-title">Editor</div>
        <div class="setting-row">
          <span class="setting-label">Font Size</span>
          <div class="setting-control">
            <input type="number" id="set-font-size" value="${cfg['editor.fontSize'] || 16}" />
          </div>
        </div>
        <div class="setting-row">
          <span class="setting-label">Word Wrap</span>
          <div class="setting-control">
            <input type="checkbox" id="set-word-wrap" ${cfg['editor.wordWrap'] ? 'checked' : ''} />
          </div>
        </div>
        <div class="setting-row" style="display:block;">
          <span class="setting-label">Spellcheck</span>
          <div style="font-size:12px;color:var(--fg-tab);margin-top:4px;">Click the <strong>Spellcheck</strong> button in the toolbar (or status bar) to underline misspelled words. Spellcheck does not run while you type.</div>
        </div>
        <div class="setting-row">
          <span class="setting-label">Auto Save</span>
          <div class="setting-control">
            <input type="checkbox" id="set-autosave" ${cfg['editor.autoSave'] ? 'checked' : ''} />
          </div>
        </div>
      </div>
      <div class="settings-group">
        <div class="settings-group-title">Appearance</div>
        <div class="setting-row">
          <span class="setting-label">Theme</span>
          <div class="setting-control">
            <select id="set-theme">
              <option value="cognitience-dark" ${cfg['theme.current'] === 'cognitience-dark' ? 'selected' : ''}>Cognitience Dark</option>
              <option value="cognitience-light" ${cfg['theme.current'] === 'cognitience-light' ? 'selected' : ''}>Cognitience Light</option>
              <option value="cognitience-sepia" ${cfg['theme.current'] === 'cognitience-sepia' ? 'selected' : ''}>Cognitience Sepia</option>
              <option value="cognitience-contrast-dark" ${cfg['theme.current'] === 'cognitience-contrast-dark' ? 'selected' : ''}>High Contrast Dark</option>
            </select>
          </div>
        </div>
        <div class="setting-row">
          <span class="setting-label">Max Line Width</span>
          <div class="setting-control">
            <input type="number" id="set-max-width" value="${cfg['editor.maxLineWidth'] || 720}" />
          </div>
        </div>
      </div>
      <div class="settings-group">
        <div class="settings-group-title">Templates</div>
        <div class="setting-row" style="display:block;">
          <span class="setting-label" style="display:block;margin-bottom:6px;">Document Templates</span>
          <div style="font-size:12px;color:var(--fg-tab);margin-bottom:8px;">Cognitience WP includes built-in templates for arXiv research papers, outlines, emails, book manuscripts, and blank documents. Use templates to jumpstart your writing.</div>
          <button class="panel-btn primary" id="set-browse-templates">Browse Templates</button>
        </div>
      </div>
      <div class="settings-group">
        <div class="settings-group-title">Updates</div>
        <div class="setting-row">
          <span class="setting-label">Current Version</span>
          <div class="setting-control">
            <span style="font-size:13px;color:var(--fg-tab);">v${(window.cognitience && window.cognitience.version) || '0.0.0'}</span>
          </div>
        </div>
        <div class="setting-row">
          <span class="setting-label">Check for Updates</span>
          <div class="setting-control">
            <button class="panel-btn" id="set-check-updates">Check Now</button>
          </div>
        </div>
        <div class="setting-row">
          <span class="setting-label">Auto-Update</span>
          <div class="setting-control">
            <input type="checkbox" id="set-autoupdate" ${cfg['app.autoUpdate'] !== false ? 'checked' : ''} />
          </div>
        </div>
      </div>
      <div class="settings-group">
        <div class="settings-group-title">Plugins &amp; Development</div>
        <div class="setting-row" style="display:block;">
          <span class="setting-label" style="display:block;margin-bottom:6px;">Plugin File Format</span>
          <div style="font-size:12px;color:var(--fg-tab);margin-bottom:8px;">Extensions use the <code>.cogwp</code> file format. Create extensions with a package.json manifest and main.js entry file.</div>
        </div>
        <div class="setting-row">
          <span class="setting-label">Create New Extension</span>
          <div class="setting-control">
            <button class="panel-btn" id="set-create-extension">Scaffold New Extension</button>
          </div>
        </div>
        <div class="setting-row">
          <span class="setting-label">Developer Mode</span>
          <div class="setting-control">
            <input type="checkbox" id="set-dev-mode" ${cfg['app.developerMode'] ? 'checked' : ''} />
          </div>
        </div>
        <div class="setting-row">
          <span class="setting-label">Plugin Documentation</span>
          <div class="setting-control">
            <button class="panel-btn" id="set-view-docs">View Documentation</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Wire up settings
  document.getElementById('set-font-size').addEventListener('change', (e) => {
    window.cognitience.config.set('editor.fontSize', parseInt(e.target.value));
  });
  document.getElementById('set-word-wrap').addEventListener('change', (e) => {
    window.cognitience.config.set('editor.wordWrap', e.target.checked);
  });
  document.getElementById('set-autosave').addEventListener('change', (e) => {
    window.cognitience.config.set('editor.autoSave', e.target.checked);
  });
  document.getElementById('set-theme').addEventListener('change', (e) => {
    window.cognitience.theme.set(e.target.value);
  });
  document.getElementById('set-max-width').addEventListener('change', (e) => {
    window.cognitience.config.set('editor.maxLineWidth', parseInt(e.target.value));
  });
  // Templates
  document.getElementById('set-browse-templates').addEventListener('click', () => {
    showSidebarView('templates');
  });
  // Updates
  document.getElementById('set-check-updates').addEventListener('click', () => {
    checkForUpdates();
  });
  document.getElementById('set-autoupdate').addEventListener('change', (e) => {
    window.cognitience.config.set('app.autoUpdate', e.target.checked);
  });
  // Plugins & Development
  document.getElementById('set-create-extension').addEventListener('click', async () => {
    const result = await window.cognitience.extensions.scaffoldPlugin();
    if (result && result.success) {
      showNotification('success', 'Plugin Created', `Plugin scaffolded at: ${result.path}`);
    } else if (result && result.error) {
      showNotification('error', 'Plugin Creation Failed', result.error);
    }
  });
  document.getElementById('set-dev-mode').addEventListener('change', (e) => {
    window.cognitience.config.set('app.developerMode', e.target.checked);
    showNotification('info', 'Developer Mode', e.target.checked ? 'Developer mode enabled' : 'Developer mode disabled');
  });
  document.getElementById('set-view-docs').addEventListener('click', () => {
    showPluginDocs('overview');
  });
}

// ═══════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    // Escape: exit focus mode or close find panel
    if (e.key === 'Escape') {
      if (CognitienceWP.focusMode) {
        toggleFocusMode();
        return;
      }
      const findPanel = document.getElementById('bottom-panel');
      if (findPanel && !findPanel.classList.contains('hidden')) {
        toggleFindReplace(false);
        return;
      }
    }
    // Ctrl+N: New document
    if (ctrl && !e.shiftKey && e.key === 'n') {
      e.preventDefault();
      newDocument();
    }
    // Ctrl+O: Open
    if (ctrl && !e.shiftKey && e.key === 'o') {
      e.preventDefault();
      openDocument();
    }
    // Ctrl+S: Save
    if (ctrl && !e.shiftKey && e.key === 's') {
      e.preventDefault();
      saveDocument();
    }
    // Ctrl+Shift+S: Save As
    if (ctrl && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      saveAsDocument();
    }
    // Ctrl+Shift+P: Command Palette
    if (ctrl && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
      e.preventDefault();
      openCommandPalette();
    }
    // Ctrl+B: Bold
    if (ctrl && !e.shiftKey && e.key === 'b') {
      e.preventDefault();
      executeFormatCommand('bold');
    }
    // Ctrl+Shift+B: Toggle sidebar
    if (ctrl && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
      e.preventDefault();
      toggleSidebar();
    }
    // Ctrl+Shift+O: Toggle outline
    if (ctrl && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
      e.preventDefault();
      toggleRightPanel();
    }
    // Ctrl+Shift+F: Focus mode
    if (ctrl && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault();
      toggleFocusMode();
    }
    // F11: Fullscreen
    if (e.key === 'F11') {
      e.preventDefault();
      window.cognitience.window.fullscreen();
    }
    // Ctrl+/: Keyboard shortcuts help
    if (ctrl && e.key === '/') {
      e.preventDefault();
      showShortcutsHelp();
    }
    // Ctrl+F: Find
    if (ctrl && !e.shiftKey && e.key === 'f') {
      e.preventDefault();
      toggleFindReplace();
    }
    // Ctrl+H: Replace
    if (ctrl && !e.shiftKey && e.key === 'h') {
      e.preventDefault();
      toggleFindReplace(true);
    }
    // Ctrl+= (Ctrl++): Increase font size by 1px
    if (ctrl && !e.shiftKey && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      changeFontSize(1);
    }
    // Ctrl+-: Decrease font size by 1px
    if (ctrl && !e.shiftKey && e.key === '-') {
      e.preventDefault();
      changeFontSize(-1);
    }
    // Ctrl+0: Reset font size to default
    if (ctrl && !e.shiftKey && e.key === '0') {
      e.preventDefault();
      resetFontSize();
    }
    // Escape: Close overlays
    if (e.key === 'Escape') {
      closeCommandPalette();
      closeContextMenu();
    }
  });
}

function isEditorFocused() {
  return document.activeElement === CognitienceWP.editor;
}

// ═══════════════════════════════════════════════════════════
// COMMAND PALETTE
// ═══════════════════════════════════════════════════════════

const BUILTIN_COMMANDS = [
  { id: 'doc:new', title: 'New Document', category: 'File', shortcut: 'Ctrl+N' },
  { id: 'doc:open', title: 'Open File…', category: 'File', shortcut: 'Ctrl+O' },
  { id: 'doc:save', title: 'Save', category: 'File', shortcut: 'Ctrl+S' },
  { id: 'doc:saveAs', title: 'Save As…', category: 'File', shortcut: 'Ctrl+Shift+S' },
  { id: 'doc:export:md', title: 'Export as Markdown', category: 'File' },
  { id: 'doc:export:html', title: 'Export as HTML', category: 'File' },
  { id: 'doc:export:pdf', title: 'Export as PDF', category: 'File' },
  { id: 'doc:export:docx', title: 'Export as Word (.docx)', category: 'File' },
  { id: 'doc:export:doc', title: 'Export as Word 97-2003 (.doc)', category: 'File' },
  { id: 'doc:export:txt', title: 'Export as Plain Text', category: 'File' },
  { id: 'doc:export:cog', title: 'Export as Cognitience Document', category: 'File' },
  { id: 'doc:print', title: 'Print…', category: 'File', shortcut: 'Ctrl+P' },
  { id: 'editor:find', title: 'Find', category: 'Edit', shortcut: 'Ctrl+F' },
  { id: 'editor:replace', title: 'Replace', category: 'Edit', shortcut: 'Ctrl+H' },
  { id: 'editor:undo', title: 'Undo', category: 'Edit', shortcut: 'Ctrl+Z' },
  { id: 'editor:redo', title: 'Redo', category: 'Edit', shortcut: 'Ctrl+Y' },
  { id: 'format:bold', title: 'Bold', category: 'Format', shortcut: 'Ctrl+B' },
  { id: 'format:italic', title: 'Italic', category: 'Format', shortcut: 'Ctrl+I' },
  { id: 'format:underline', title: 'Underline', category: 'Format', shortcut: 'Ctrl+U' },
  { id: 'format:strikethrough', title: 'Strikethrough', category: 'Format' },
  { id: 'format:clear', title: 'Clear Formatting', category: 'Format' },
  { id: 'insert:heading1', title: 'Heading 1', category: 'Insert', shortcut: 'Ctrl+1' },
  { id: 'insert:heading2', title: 'Heading 2', category: 'Insert', shortcut: 'Ctrl+2' },
  { id: 'insert:heading3', title: 'Heading 3', category: 'Insert', shortcut: 'Ctrl+3' },
  { id: 'insert:link', title: 'Insert Link', category: 'Insert', shortcut: 'Ctrl+K' },
  { id: 'insert:image', title: 'Insert Image', category: 'Insert' },
  { id: 'insert:table', title: 'Insert Table', category: 'Insert' },
  { id: 'insert:codeBlock', title: 'Code Block', category: 'Insert' },
  { id: 'insert:quote', title: 'Quote Block', category: 'Insert' },
  { id: 'insert:hr', title: 'Horizontal Rule', category: 'Insert' },
  { id: 'insert:checklist', title: 'Checklist', category: 'Insert' },
  { id: 'template:arxiv', title: 'Insert Template: arXiv Research Paper', category: 'Insert' },
  { id: 'template:outline', title: 'Insert Template: Outline', category: 'Insert' },
  { id: 'template:email', title: 'Insert Template: Email', category: 'Insert' },
  { id: 'template:book', title: 'Insert Template: Book Manuscript', category: 'Insert' },
  { id: 'template:blank', title: 'New from Template: Blank', category: 'Insert' },
  { id: 'view:templates', title: 'Browse Templates', category: 'View' },
  { id: 'view:toggleSidebar', title: 'Toggle Sidebar', category: 'View', shortcut: 'Ctrl+Shift+B' },
  { id: 'view:toggleOutline', title: 'Toggle Outline', category: 'View', shortcut: 'Ctrl+Shift+O' },
  { id: 'view:toggleFocusMode', title: 'Toggle Focus Mode', category: 'View', shortcut: 'Ctrl+Shift+F' },
  { id: 'view:toggleFullscreen', title: 'Toggle Full Screen', category: 'View', shortcut: 'F11' },
  { id: 'view:zoomIn', title: 'Zoom In', category: 'View' },
  { id: 'view:zoomOut', title: 'Zoom Out', category: 'View' },
  { id: 'view:zoomReset', title: 'Reset Zoom', category: 'View' },
  { id: 'view:commandPalette', title: 'Command Palette', category: 'View', shortcut: 'Ctrl+Shift+P' },
  { id: 'theme:dark', title: 'Theme: Cognitience Dark', category: 'Theme' },
  { id: 'theme:light', title: 'Theme: Cognitience Light', category: 'Theme' },
  { id: 'theme:sepia', title: 'Theme: Cognitience Sepia', category: 'Theme' },
  { id: 'theme:contrast', title: 'Theme: High Contrast', category: 'Theme' },
  { id: 'tools:wordCount', title: 'Word Count', category: 'Tools' },
  { id: 'tools:settings', title: 'Settings', category: 'Tools', shortcut: 'Ctrl+,' },
  { id: 'ext:manage', title: 'Manage Extensions', category: 'Extensions' },
  { id: 'ext:browse', title: 'Browse Extensions', category: 'Extensions' },
  { id: 'ext:reloadAll', title: 'Reload All Extensions', category: 'Extensions' },
  { id: 'ext:docs:overview', title: 'Plugin Docs: Overview', category: 'Extensions' },
  { id: 'ext:docs:create', title: 'Plugin Docs: Creating an Extension', category: 'Extensions' },
  { id: 'ext:docs:manifest', title: 'Plugin Docs: Manifest Reference', category: 'Extensions' },
  { id: 'ext:docs:api', title: 'Plugin Docs: Extension API Reference', category: 'Extensions' },
  { id: 'ext:docs:commands', title: 'Plugin Docs: Commands & Menus', category: 'Extensions' },
  { id: 'ext:docs:editor', title: 'Plugin Docs: Editor Interaction', category: 'Extensions' },
  { id: 'ext:docs:events', title: 'Plugin Docs: Lifecycle Events', category: 'Extensions' },
  { id: 'ext:docs:publish', title: 'Plugin Docs: Publishing & Distribution', category: 'Extensions' },
  { id: 'ext:docs:example', title: 'Plugin Docs: Example Extension', category: 'Extensions' },
  { id: 'help:shortcuts', title: 'Keyboard Shortcuts', category: 'Help' },
  { id: 'help:about', title: 'About Cognitience WP', category: 'Help' },
];

function setupCommandPalette() {
  const overlay = document.getElementById('palette-overlay');
  const input = document.getElementById('palette-input');

  overlay.addEventListener('click', closeCommandPalette);
  input.addEventListener('input', () => filterCommands(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCommandPalette();
    if (e.key === 'ArrowDown') navigatePalette(1);
    if (e.key === 'ArrowUp') navigatePalette(-1);
    if (e.key === 'Enter') executePaletteSelected();
  });
}

function openCommandPalette() {
  const palette = document.getElementById('command-palette');
  palette.classList.remove('hidden');
  const input = document.getElementById('palette-input');
  input.value = '';
  input.focus();
  filterCommands('');
}

function closeCommandPalette() {
  const palette = document.getElementById('command-palette');
  palette.classList.add('hidden');
}

let paletteSelectedIndex = 0;

function filterCommands(query) {
  const results = document.getElementById('palette-results');
  const q = query.toLowerCase().trim();

  // Combine builtin commands with extension commands
  let allCommands = [...BUILTIN_COMMANDS];
  try {
    const extCommands = window.cognitience.extensions.getCommandsSync?.() || [];
    extCommands.forEach(cmd => {
      allCommands.push({ id: cmd, title: cmd.split('.').pop(), category: 'Extension' });
    });
  } catch (e) {}

  let filtered;
  if (!q) {
    filtered = allCommands.slice(0, 50);
  } else {
    filtered = allCommands.filter(c =>
      c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)
    );
  }

  paletteSelectedIndex = 0;
  results.innerHTML = filtered.map((c, i) => `
    <div class="palette-item ${i === 0 ? 'selected' : ''}" data-cmd-id="${c.id}" data-index="${i}">
      <span class="palette-icon">▶</span>
      <span>${c.title}</span>
      <span class="palette-category">${c.category}${c.shortcut ? ' · ' + c.shortcut : ''}</span>
    </div>
  `).join('');

  // Click handlers
  results.querySelectorAll('.palette-item').forEach(item => {
    item.addEventListener('click', () => {
      paletteSelectedIndex = parseInt(item.dataset.index);
      executePaletteSelected();
    });
    item.addEventListener('mouseenter', () => {
      paletteSelectedIndex = parseInt(item.dataset.index);
      updatePaletteSelection();
    });
  });
}

function navigatePalette(direction) {
  const items = document.querySelectorAll('.palette-item');
  if (!items.length) return;
  paletteSelectedIndex += direction;
  if (paletteSelectedIndex < 0) paletteSelectedIndex = items.length - 1;
  if (paletteSelectedIndex >= items.length) paletteSelectedIndex = 0;
  updatePaletteSelection();
}

function updatePaletteSelection() {
  document.querySelectorAll('.palette-item').forEach((item, i) => {
    item.classList.toggle('selected', i === paletteSelectedIndex);
    if (i === paletteSelectedIndex) item.scrollIntoView({ block: 'nearest' });
  });
}

function executePaletteSelected() {
  const items = document.querySelectorAll('.palette-item');
  if (!items.length) return;
  const selected = items[paletteSelectedIndex];
  if (!selected) return;
  const cmdId = selected.dataset.cmdId;
  closeCommandPalette();
  executeCommandById(cmdId);
}

function executeCommandById(cmdId) {
  switch (cmdId) {
    case 'doc:new': newDocument(); break;
    case 'doc:open': openDocument(); break;
    case 'doc:save': saveDocument(); break;
    case 'doc:saveAs': saveAsDocument(); break;
    case 'doc:export:md': exportDocument('markdown'); break;
    case 'doc:export:html': exportDocument('html'); break;
    case 'doc:export:pdf': exportDocument('pdf'); break;
    case 'doc:export:docx': exportDocument('docx'); break;
    case 'doc:export:doc': exportDocument('doc'); break;
    case 'doc:export:txt': exportDocument('plaintext'); break;
    case 'doc:export:cog': exportDocument('cog'); break;
    case 'doc:print': window.print(); break;
    case 'editor:find': toggleFindReplace(); break;
    case 'editor:replace': toggleFindReplace(true); break;
    case 'editor:undo': document.execCommand('undo'); break;
    case 'editor:redo': document.execCommand('redo'); break;
    case 'format:bold': executeFormatCommand('bold'); break;
    case 'format:italic': executeFormatCommand('italic'); break;
    case 'format:underline': executeFormatCommand('underline'); break;
    case 'format:strikethrough': executeFormatCommand('strikethrough'); break;
    case 'format:clear': executeFormatCommand('removeFormat'); break;
    case 'insert:heading1': document.execCommand('formatBlock', false, 'H1'); break;
    case 'insert:heading2': document.execCommand('formatBlock', false, 'H2'); break;
    case 'insert:heading3': document.execCommand('formatBlock', false, 'H3'); break;
    case 'insert:link': executeFormatCommand('createLink'); break;
    case 'insert:image': executeFormatCommand('insertImage'); break;
    case 'insert:table': insertTable(); break;
    case 'insert:codeBlock': document.execCommand('formatBlock', false, 'PRE'); break;
    case 'insert:quote': document.execCommand('formatBlock', false, 'BLOCKQUOTE'); break;
    case 'insert:hr': document.execCommand('insertHorizontalRule'); break;
    case 'insert:checklist': toggleChecklistItem(); break;
    case 'template:arxiv': insertTemplate('arxiv'); break;
    case 'template:outline': insertTemplate('outline'); break;
    case 'template:email': insertTemplate('email'); break;
    case 'template:book': insertTemplate('book'); break;
    case 'template:blank': insertTemplate('blank'); break;
    case 'view:templates': showSidebarView('templates'); break;
    case 'view:toggleSidebar': toggleSidebar(); break;
    case 'view:toggleOutline': toggleRightPanel(); break;
    case 'view:toggleFocusMode': toggleFocusMode(); break;
    case 'view:toggleFullscreen': window.cognitience.window.fullscreen(); break;
    case 'view:zoomIn': zoomEditor(1); break;
    case 'view:zoomOut': zoomEditor(-1); break;
    case 'view:zoomReset': zoomEditor(0, true); break;
    case 'view:commandPalette': openCommandPalette(); break;
    case 'theme:dark': applyTheme('cognitience-dark'); window.cognitience.theme.set('cognitience-dark'); break;
    case 'theme:light': applyTheme('cognitience-light'); window.cognitience.theme.set('cognitience-light'); break;
    case 'theme:sepia': applyTheme('cognitience-sepia'); window.cognitience.theme.set('cognitience-sepia'); break;
    case 'theme:contrast': applyTheme('cognitience-contrast-dark'); window.cognitience.theme.set('cognitience-contrast-dark'); break;
    case 'tools:wordCount': showWordCountDialog(); break;
    case 'tools:settings': showSidebarView('settings'); break;
    case 'ext:manage': showSidebarView('extensions'); break;
    case 'ext:browse':
      if (CognitienceWP.config['extensions.galleryEnabled']) {
        showNotification('info', 'Extension Gallery', 'Extension gallery coming soon!');
      } else {
        showNotification('info', 'Extension Gallery', 'Gallery is not available yet. Install extensions from a .cogwp file.');
      }
      break;
    case 'ext:reloadAll': reloadAllExtensions(); break;
    case 'ext:docs:overview': showPluginDocs('overview'); break;
    case 'ext:docs:create': showPluginDocs('create'); break;
    case 'ext:docs:manifest': showPluginDocs('manifest'); break;
    case 'ext:docs:api': showPluginDocs('api'); break;
    case 'ext:docs:commands': showPluginDocs('commands'); break;
    case 'ext:docs:editor': showPluginDocs('editor'); break;
    case 'ext:docs:events': showPluginDocs('events'); break;
    case 'ext:docs:publish': showPluginDocs('publish'); break;
    case 'ext:docs:example': showPluginDocs('example'); break;
    case 'help:shortcuts': showShortcutsHelp(); break;
    case 'help:about': showAboutDialog(); break;
    default:
      window.cognitience.extensions.executeCommand(cmdId).catch(err => {
        showNotification('error', 'Command Error', err.message);
      });
  }
}

// ═══════════════════════════════════════════════════════════
// DOCUMENT OPERATIONS
// ═══════════════════════════════════════════════════════════

function updateDocTitle(title) {
  const el = document.getElementById('doc-title');
  if (el) el.textContent = title + ' — Cognitience WP';
}

async function newDocument() {
  if (!confirmDiscardIfDirty()) return;
  CognitienceWP.editor.innerHTML = '<h1>Untitled Document</h1><p></p>';
  CognitienceWP.docTitle = 'Untitled';
  CognitienceWP.docPath = null;
  CognitienceWP.docFormat = 'rich';
  markClean();
  updateWordCount();
  CognitienceWP.editor.focus();
  updateDocTitle('Untitled');
}

async function openDocument(filePath) {
  if (!confirmDiscardIfDirty()) return;
  const result = await window.cognitience.documents.open(filePath);
  if (!result) return;

  CognitienceWP.editor.innerHTML = result.content;
  CognitienceWP.docTitle = result.title;
  CognitienceWP.docPath = result.filePath;
  CognitienceWP.docFormat = result.format;
  markClean();
  updateDocTitle(result.title);

  // Add to recent files
  const exists = CognitienceWP.recentFiles.find(f => f.path === result.filePath);
  if (!exists) {
    CognitienceWP.recentFiles.unshift({ name: result.title, path: result.filePath });
    if (CognitienceWP.recentFiles.length > 10) CognitienceWP.recentFiles.pop();
  }

  updateWordCount();
  updateOutline();
  CognitienceWP.editor.focus();
}

async function saveDocument() {
  if (!CognitienceWP.docPath) {
    return saveAsDocument();
  }
  const content = CognitienceWP.editor.innerHTML;
  await window.cognitience.documents.save({
    content,
    filePath: CognitienceWP.docPath,
    format: CognitienceWP.docFormat,
    title: CognitienceWP.docTitle,
  });
  markClean();
  showNotification('info', 'Saved', CognitienceWP.docTitle);
}

async function saveAsDocument() {
  const content = CognitienceWP.editor.innerHTML;
  const result = await window.cognitience.documents.saveAs({
    content,
    format: CognitienceWP.docFormat,
    title: CognitienceWP.docTitle,
  });
  if (!result) return;
  CognitienceWP.docPath = result.filePath;
  CognitienceWP.docTitle = result.filePath.split(/[\\\/]/).pop().replace(/\.[^.]+$/, '');
  updateDocTitle(CognitienceWP.docTitle);
  markClean();
  showNotification('info', 'Saved', CognitienceWP.docTitle);
}

async function exportDocument(format) {
  const content = CognitienceWP.editor.innerHTML;
  const title = CognitienceWP.docTitle;

  const result = await window.cognitience.documents.export({ format, content, title });
  if (result && result.success) {
    showNotification('success', 'Exported', `Exported as ${format.toUpperCase()}`);
  } else if (result && result.error) {
    showNotification('error', 'Export Failed', result.error);
  }
}

function htmlToMarkdown(element) {
  let md = '';
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      md += node.textContent;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    switch (tag) {
      case 'h1': md += '\n# '; break;
      case 'h2': md += '\n## '; break;
      case 'h3': md += '\n### '; break;
      case 'h4': md += '\n#### '; break;
      case 'h5': md += '\n##### '; break;
      case 'h6': md += '\n###### '; break;
      case 'strong': case 'b': md += '**'; break;
      case 'em': case 'i': md += '*'; break;
      case 'u': md += '__'; break;
      case 's': case 'strike': case 'del': md += '~~'; break;
      case 'code': md += '`'; break;
      case 'pre': md += '\n```\n'; break;
      case 'blockquote': md += '\n> '; break;
      case 'br': md += '\n'; return;
      case 'hr': md += '\n---\n'; return;
      case 'li': md += '\n- '; break;
      case 'a': md += '['; break;
    }
    for (const child of node.childNodes) walk(child);
    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        md += '\n'; break;
      case 'strong': case 'b': md += '**'; break;
      case 'em': case 'i': md += '*'; break;
      case 'u': md += '__'; break;
      case 's': case 'strike': case 'del': md += '~~'; break;
      case 'code': md += '`'; break;
      case 'pre': md += '\n```\n'; break;
      case 'blockquote': md += '\n'; break;
      case 'a':
        md += '](' + node.getAttribute('href') + ')'; break;
      case 'p': md += '\n\n'; break;
    }
  };
  walk(element);
  return md;
}

function openRecentFile(filePath) {
  openDocument(filePath);
}

// ═══════════════════════════════════════════════════════════
// FIND & REPLACE
// ═══════════════════════════════════════════════════════════

function setupFindReplace() {
  const findInput = document.getElementById('find-input');
  const findNext = document.getElementById('find-next');
  const findPrev = document.getElementById('find-prev');
  const replaceInput = document.getElementById('replace-input');
  const replaceBtn = document.getElementById('replace-btn');
  const replaceAllBtn = document.getElementById('replace-all-btn');
  const closeBtn = document.getElementById('close-find');

  findNext.addEventListener('click', () => findNextMatch());
  findPrev.addEventListener('click', () => findNextMatch(true));
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') findNextMatch(e.shiftKey);
    if (e.key === 'Escape') toggleFindReplace(false);
  });
  replaceBtn.addEventListener('click', () => doReplace(false));
  replaceAllBtn.addEventListener('click', () => doReplace(true));
  closeBtn.addEventListener('click', () => toggleFindReplace(false));
}

function toggleFindReplace(showReplace) {
  const panel = document.getElementById('bottom-panel');
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden');
    document.getElementById('find-input').focus();
  } else if (showReplace === false) {
    panel.classList.add('hidden');
    CognitienceWP.editor.focus();
    return;
  }
  if (showReplace) {
    document.getElementById('replace-input').focus();
  } else {
    document.getElementById('find-input').focus();
  }
}

function findNextMatch(reverse) {
  const query = document.getElementById('find-input').value;
  if (!query) return;
  // Use browser's find via window.find
  const found = window.find(query, false, reverse || false, true, false, true, false);
  if (!found) {
    document.getElementById('find-count').textContent = 'Not found';
  } else {
    document.getElementById('find-count').textContent = '';
  }
}

function replaceAllInTextNodes(root, findVal, replaceVal) {
  const regex = new RegExp(findVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let replacements = 0;
  for (const node of nodes) {
    const text = node.textContent || '';
    const newText = text.replace(regex, replaceVal);
    if (newText !== text) {
      node.textContent = newText;
      replacements++;
    }
  }
  return replacements;
}

function doReplace(all) {
  const findVal = document.getElementById('find-input').value;
  const replaceVal = document.getElementById('replace-input').value;
  if (!findVal) return;

  if (all) {
    const count = replaceAllInTextNodes(CognitienceWP.editor, findVal, replaceVal);
    showNotification('info', 'Replace All', `Replaced ${count} occurrence(s) of "${escapeHtml(findVal)}"`);
    markDirty();
    updateWordCount();
  } else {
    const sel = window.getSelection();
    if (sel.toString().toLowerCase() === findVal.toLowerCase()) {
      document.execCommand('insertText', false, replaceVal);
      markDirty();
      updateWordCount();
    } else {
      findNextMatch();
      if (window.getSelection().toString().toLowerCase() === findVal.toLowerCase()) {
        document.execCommand('insertText', false, replaceVal);
        markDirty();
        updateWordCount();
      }
    }
  }
}

function performSearch(query) {
  if (!query) return;
  const results = document.getElementById('search-results');
  const text = CognitienceWP.editor.innerText;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matches = [];
  let pos = 0;
  while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
    matches.push({ pos, context: text.substring(Math.max(0, pos - 20), pos + query.length + 20) });
    pos += query.length;
  }

  if (matches.length === 0) {
    results.innerHTML = '<div style="padding:8px 12px;color:var(--fg-tab);font-size:12px;">No results found</div>';
    return;
  }

  results.innerHTML = matches.slice(0, 50).map((m, i) => `
    <div class="search-result" data-index="${i}">
      <div>${m.context.substring(0, Math.min(40, m.context.length))}…</div>
    </div>
  `).join('');

  results.querySelectorAll('.search-result').forEach(item => {
    item.addEventListener('click', () => {
      findNextMatch();
    });
  });
}

// ═══════════════════════════════════════════════════════════
// VIEW TOGGLES
// ═══════════════════════════════════════════════════════════

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  CognitienceWP.sidebarVisible = !CognitienceWP.sidebarVisible;
  sidebar.classList.toggle('hidden', !CognitienceWP.sidebarVisible);
}

function toggleRightPanel() {
  const panel = document.getElementById('right-panel');
  CognitienceWP.rightPanelVisible = !CognitienceWP.rightPanelVisible;
  panel.classList.toggle('hidden', !CognitienceWP.rightPanelVisible);
  if (CognitienceWP.rightPanelVisible) {
    renderOutline(document.getElementById('outline-tree'));
  }
}

function toggleFocusMode() {
  CognitienceWP.focusMode = !CognitienceWP.focusMode;
  document.body.classList.toggle('focus-mode', CognitienceWP.focusMode);
  if (CognitienceWP.focusMode) {
    CognitienceWP.editor.focus();
  }
}

function changeFontSize(delta) {
  let current = CognitienceWP.config['editor.fontSize'] || 12;
  current = Math.max(6, Math.min(120, current + delta));
  CognitienceWP.config['editor.fontSize'] = current;
  window.cognitience.config.set('editor.fontSize', current);
  document.documentElement.style.setProperty('--editor-font-size', current + 'px');
  const input = document.getElementById('font-size-input');
  if (input) input.value = current;
}

function resetFontSize() {
  const defaultSize = 12;
  CognitienceWP.config['editor.fontSize'] = defaultSize;
  window.cognitience.config.set('editor.fontSize', defaultSize);
  document.documentElement.style.setProperty('--editor-font-size', defaultSize + 'px');
  const input = document.getElementById('font-size-input');
  if (input) input.value = defaultSize;
}

function zoomEditor(direction, reset) {
  if (reset) {
    resetFontSize();
  } else {
    changeFontSize(direction);
  }
}

function updateOutline() {
  if (CognitienceWP.rightPanelVisible) {
    renderOutline(document.getElementById('outline-tree'));
  }
}

// ═══════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════

function showNotification(type, title, message) {
  const container = document.getElementById('notification-container');
  const notif = document.createElement('div');
  notif.className = `notification ${type}`;
  notif.innerHTML = `
    <div class="notification-content">
      <div class="notification-title">${escapeHtml(title)}</div>
      <div>${escapeHtml(message || '')}</div>
    </div>
    <button class="notification-close">×</button>
  `;
  container.appendChild(notif);

  const closeBtn = notif.querySelector('.notification-close');
  closeBtn.addEventListener('click', () => notif.remove());

  setTimeout(() => notif.remove(), 4000);
}

// ═══════════════════════════════════════════════════════════
// CONTEXT MENU
// ═══════════════════════════════════════════════════════════

let contextMenuEl = null;

async function showContextMenu(x, y, spellCtx) {
  closeContextMenu();
  contextMenuEl = document.createElement('div');
  contextMenuEl.className = 'context-menu';
  contextMenuEl.style.left = x + 'px';
  contextMenuEl.style.top = y + 'px';

  const sel = window.getSelection().toString();
  const hasSelection = sel.length > 0;

  let spellHtml = '';
  const misspelled = spellCtxToMenu(spellCtx);
  if (misspelled && misspelled.suggestions.length > 0) {
    spellHtml = '<div class="context-menu-spell-header">Suggestions</div>';
    for (const s of misspelled.suggestions.slice(0, 5)) {
      spellHtml += `<div class="context-menu-item spell-suggestion" data-action="spellfix" data-word="${s}"><span>${s}</span></div>`;
    }
    spellHtml += '<div class="context-menu-separator"></div>';
    spellHtml += `<div class="context-menu-item" data-action="spelladd" data-word="${misspelled.word}"><span>Add "${misspelled.word}" to Dictionary</span></div>`;
    spellHtml += '<div class="context-menu-separator"></div>';
  } else if (misspelled) {
    spellHtml = `<div class="context-menu-item disabled"><span>No suggestions for "${misspelled.word}"</span></div>`;
    spellHtml += `<div class="context-menu-item" data-action="spelladd" data-word="${misspelled.word}"><span>Add "${misspelled.word}" to Dictionary</span></div>`;
    spellHtml += '<div class="context-menu-separator"></div>';
  }

  contextMenuEl.innerHTML = `
    ${spellHtml}
    <div class="context-menu-item ${hasSelection ? '' : 'disabled'}" data-action="cut">
      <span>Cut</span><span class="context-menu-shortcut">Ctrl+X</span>
    </div>
    <div class="context-menu-item ${hasSelection ? '' : 'disabled'}" data-action="copy">
      <span>Copy</span><span class="context-menu-shortcut">Ctrl+C</span>
    </div>
    <div class="context-menu-item" data-action="paste">
      <span>Paste</span><span class="context-menu-shortcut">Ctrl+V</span>
    </div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" data-action="bold">
      <span>Bold</span><span class="context-menu-shortcut">Ctrl+B</span>
    </div>
    <div class="context-menu-item" data-action="italic">
      <span>Italic</span><span class="context-menu-shortcut">Ctrl+I</span>
    </div>
    <div class="context-menu-item" data-action="underline">
      <span>Underline</span><span class="context-menu-shortcut">Ctrl+U</span>
    </div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" data-action="link">
      <span>Insert Link</span><span class="context-menu-shortcut">Ctrl+K</span>
    </div>
    <div class="context-menu-item" data-action="image">
      <span>Insert Image</span>
    </div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" data-action="find">
      <span>Find</span><span class="context-menu-shortcut">Ctrl+F</span>
    </div>
    <div class="context-menu-item" data-action="palette">
      <span>Command Palette</span><span class="context-menu-shortcut">Ctrl+Shift+P</span>
    </div>
  `;

  document.body.appendChild(contextMenuEl);

  contextMenuEl.querySelectorAll('.context-menu-item').forEach(item => {
    if (item.classList.contains('disabled')) return;
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      closeContextMenu();
      switch (action) {
        case 'cut': document.execCommand('cut'); break;
        case 'copy': document.execCommand('copy'); break;
        case 'paste': document.execCommand('paste'); break;
        case 'bold': executeFormatCommand('bold'); break;
        case 'italic': executeFormatCommand('italic'); break;
        case 'underline': executeFormatCommand('underline'); break;
        case 'link': executeFormatCommand('createLink'); break;
        case 'image': executeFormatCommand('insertImage'); break;
        case 'find': toggleFindReplace(); break;
        case 'palette': openCommandPalette(); break;
        case 'spellfix': applySpellingFix(item.dataset.word); break;
        case 'spelladd': addWordToDictionary(item.dataset.word); break;
      }
    });
  });
}

function closeContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.remove();
    contextMenuEl = null;
  }
}

document.addEventListener('click', closeContextMenu);

// ═══════════════════════════════════════════════════════════
// STATUS BAR
// ═══════════════════════════════════════════════════════════

function setupStatusBar() {
  const spellEl = document.getElementById('status-spellcheck');
  if (spellEl) {
    spellEl.addEventListener('click', () => runDocumentSpellcheck());
  }
}

// ═══════════════════════════════════════════════════════════
// MENU LISTENERS (from main process)
// ═══════════════════════════════════════════════════════════

function setupMenuListeners() {
  window.cognitience.window.onBeforeClose(() => {
    if (confirmDiscardIfDirty()) {
      window.cognitience.window.confirmClose();
    }
  });

  window.cognitience.on('doc:new', () => newDocument());
  window.cognitience.on('doc:open', () => openDocument());
  window.cognitience.on('doc:save', () => saveDocument());
  window.cognitience.on('doc:saveAs', () => saveAsDocument());
  window.cognitience.on('doc:export', (data) => exportDocument(data.format));
  window.cognitience.on('doc:print', () => window.print());

  window.cognitience.on('insert:heading', (data) => {
    document.execCommand('formatBlock', false, 'H' + data.level);
  });
  window.cognitience.on('insert:bold', () => executeFormatCommand('bold'));
  window.cognitience.on('insert:italic', () => executeFormatCommand('italic'));
  window.cognitience.on('insert:underline', () => executeFormatCommand('underline'));
  window.cognitience.on('insert:strikethrough', () => executeFormatCommand('strikethrough'));
  window.cognitience.on('insert:link', () => executeFormatCommand('createLink'));
  window.cognitience.on('insert:image', () => executeFormatCommand('insertImage'));
  window.cognitience.on('insert:table', () => insertTable());
  window.cognitience.on('insert:codeBlock', () => document.execCommand('formatBlock', false, 'PRE'));
  window.cognitience.on('insert:quote', () => document.execCommand('formatBlock', false, 'BLOCKQUOTE'));
  window.cognitience.on('insert:hr', () => document.execCommand('insertHorizontalRule'));
  window.cognitience.on('insert:template', (data) => insertTemplate(data.template));
  window.cognitience.on('insert:list', (data) => {
    if (data.type === 'bullet') document.execCommand('insertUnorderedList');
    else if (data.type === 'numbered') document.execCommand('insertOrderedList');
    else if (data.type === 'checklist') toggleChecklistItem();
  });

  window.cognitience.on('format:align', (data) => {
    switch (data.align) {
      case 'left': document.execCommand('justifyLeft'); break;
      case 'center': document.execCommand('justifyCenter'); break;
      case 'right': document.execCommand('justifyRight'); break;
      case 'justify': document.execCommand('justifyFull'); break;
    }
  });
  window.cognitience.on('format:subscript', () => executeFormatCommand('subscript'));
  window.cognitience.on('format:superscript', () => executeFormatCommand('superscript'));
  window.cognitience.on('format:highlight', () => document.execCommand('hiliteColor', false, '#f9e79f'));
  window.cognitience.on('format:clear', () => executeFormatCommand('removeFormat'));

  window.cognitience.on('view:toggleSidebar', () => toggleSidebar());
  window.cognitience.on('view:toggleOutline', () => toggleRightPanel());
  window.cognitience.on('view:toggleFocusMode', () => toggleFocusMode());
  window.cognitience.on('view:toggleFullscreen', () => window.cognitience.window.fullscreen());
  window.cognitience.on('view:zoomIn', () => zoomEditor(1));
  window.cognitience.on('view:zoomOut', () => zoomEditor(-1));
  window.cognitience.on('view:zoomReset', () => zoomEditor(0, true));
  window.cognitience.on('view:commandPalette', () => openCommandPalette());

  window.cognitience.on('editor:find', () => toggleFindReplace());
  window.cognitience.on('editor:replace', () => toggleFindReplace(true));
  window.cognitience.on('editor:findNext', () => findNextMatch());
  window.cognitience.on('editor:findPrev', () => findNextMatch(true));

  window.cognitience.on('tools:wordCount', () => showWordCountDialog());
  window.cognitience.on('tools:settings', () => showSidebarView('settings'));

  window.cognitience.on('ext:browse', () => showSidebarView('extensions'));
  window.cognitience.on('ext:manage', () => showSidebarView('extensions'));
  window.cognitience.on('ext:reloadAll', () => reloadAllExtensions());
  window.cognitience.on('ext:createNew', async () => {
    const result = await window.cognitience.extensions.scaffoldPlugin();
    if (result && result.success) {
      showNotification('success', 'Plugin Created', `Plugin scaffolded at: ${result.path}`);
    } else if (result && result.error) {
      showNotification('error', 'Plugin Creation Failed', result.error);
    }
  });
  window.cognitience.on('ext:docs', () => showSidebarView('docs'));

  // Toolbar button injection from extensions
  window.cognitience.on('toolbar:addButton', (data) => {
    const toolbar = document.getElementById('ext-toolbar-buttons');
    if (!toolbar) return;
    // Remove existing button with same ID
    const existing = toolbar.querySelector(`[data-ext-button="${data.id}"]`);
    if (existing) existing.remove();
    // Create new button
    const btn = document.createElement('button');
    btn.className = 'tool-btn ext-toolbar-btn';
    btn.setAttribute('data-ext-button', data.id);
    btn.title = data.tooltip || data.label || '';
    if (data.svg && typeof data.svg === 'string' && data.svg.trim().startsWith('<svg')) {
      btn.innerHTML = data.svg;
    } else {
      btn.textContent = data.label || '?';
    }
    btn.addEventListener('click', () => {
      window.cognitience.extensions.executeCommand(data.command).catch(err => {
        showNotification('error', 'Extension Error', err.message);
      });
    });
    toolbar.appendChild(btn);
  });
  window.cognitience.on('toolbar:removeButton', (data) => {
    const toolbar = document.getElementById('ext-toolbar-buttons');
    if (!toolbar) return;
    const btn = toolbar.querySelector(`[data-ext-button="${data.id}"]`);
    if (btn) btn.remove();
  });

  window.cognitience.on('help:shortcuts', () => showShortcutsHelp());
  window.cognitience.on('help:checkUpdates', () => checkForUpdates());

  window.cognitience.on('notification:info', (msg) => showNotification('info', 'Info', msg));
  window.cognitience.on('notification:warning', (msg) => showNotification('warning', 'Warning', msg));
  window.cognitience.on('notification:error', (msg) => showNotification('error', 'Error', msg));

  window.cognitience.documents.onOpen((filePath) => openDocument(filePath));
}

// ═══════════════════════════════════════════════════════════
// EXTENSION HELPERS
// ═══════════════════════════════════════════════════════════

function setupExtensionListeners() {
  window.cognitience.extensions.onInstallRequest((path) => {
    showNotification('info', 'Installing', 'Installing extension…');
  });
}

async function toggleExtension(id) {
  const ext = CognitienceWP.extensions.find(e => e.id === id);
  if (!ext) return;
  if (ext.state === 'active') {
    await window.cognitience.extensions.disable(id);
    showNotification('info', 'Disabled', ext.manifest.displayName);
  } else {
    await window.cognitience.extensions.enable(id);
    showNotification('info', 'Enabled', ext.manifest.displayName);
  }
  CognitienceWP.extensions = await window.cognitience.extensions.list();
  showSidebarView('extensions');
}

async function reloadExtension(id) {
  await window.cognitience.extensions.reload(id);
  showNotification('info', 'Reloaded', 'Extension reloaded');
  CognitienceWP.extensions = await window.cognitience.extensions.list();
}

async function uninstallExtension(id) {
  if (!confirm('Uninstall this extension?')) return;
  await window.cognitience.extensions.uninstall(id);
  showNotification('info', 'Uninstalled', 'Extension removed');
  CognitienceWP.extensions = await window.cognitience.extensions.list();
  showSidebarView('extensions');
}

async function reloadAllExtensions() {
  for (const ext of CognitienceWP.extensions) {
    await window.cognitience.extensions.reload(ext.id);
  }
  showNotification('info', 'Extensions', 'All extensions reloaded');
  CognitienceWP.extensions = await window.cognitience.extensions.list();
}

// ═══════════════════════════════════════════════════════════
// PLUGIN DOCUMENTATION (inline in sidebar)
// ═══════════════════════════════════════════════════════════

function renderPluginDocs(container) {
  container.innerHTML = `
    <div style="padding:8px 12px;font-size:13px;line-height:1.6;color:var(--fg-menu);">
      <h3 style="margin:0 0 8px;font-size:14px;">Plugin Development Guide</h3>
      <p style="margin:0 0 8px;color:var(--fg-tab);">Cognitience WP plugins use the <code>.cogwp</code> format.</p>
      <div style="margin-bottom:12px;">
        <strong style="font-size:12px;display:block;margin-bottom:4px;">Quick Start</strong>
        <ol style="margin:0;padding-left:20px;">
          <li>Help → Developer: Create New Plugin</li>
          <li>Select a folder — wizard generates files</li>
          <li>Edit package.json, main.js, icon.svg</li>
          <li>Zip as .cogwp and install</li>
        </ol>
      </div>
      <div style="margin-bottom:12px;">
        <strong style="font-size:12px;display:block;margin-bottom:4px;">Structure</strong>
        <pre style="font-size:11px;background:var(--bg-panel);padding:8px;border-radius:4px;">my-plugin/
├── package.json
├── main.js
└── icon.svg</pre>
      </div>
      <div style="margin-bottom:12px;">
        <strong style="font-size:12px;display:block;margin-bottom:4px;">Extension API</strong>
        <div style="font-size:12px;color:var(--fg-tab);">
          <div>context.commands.registerCommand()</div>
          <div>context.editor.getContent() / setContent()</div>
          <div>context.notifications.info/warning/error()</div>
          <div>context.statusBar.createItem()</div>
          <div>context.toolbar.registerButton() (SVG)</div>
          <div>context.config.get() / getAll()</div>
          <div>context.logger.info/warn/error()</div>
          <div>context.fs.readFileSync/writeFileSync()</div>
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <strong style="font-size:12px;display:block;margin-bottom:4px;">Packaging</strong>
        <p style="font-size:12px;color:var(--fg-tab);margin:0;">Zip your extension folder and rename to <code>.cogwp</code>. Install via Extensions → Install from .cogwp...</p>
      </div>
      <div style="margin-bottom:12px;">
        <strong style="font-size:12px;display:block;margin-bottom:4px;">SVG Toolbar Buttons</strong>
        <p style="font-size:12px;color:var(--fg-tab);margin:0 0 4px;">Plugins can add toolbar buttons with SVG icons:</p>
        <pre style="font-size:11px;background:var(--bg-panel);padding:8px;border-radius:4px;">ctx.toolbar.registerButton('myBtn', {
  label: 'My Button',
  tooltip: 'Click me!',
  icon: 'icon.svg',
  command: 'myExt.doSomething'
});</pre>
      </div>
      <button class="panel-btn primary" style="width:100%;margin-top:4px;" onclick="showPluginDocs('overview')">Open Full Documentation</button>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════
// PLUGIN DOCUMENTATION (modal)
// ═══════════════════════════════════════════════════════════

function showPluginDocs(topic) {
  const docs = {
    overview: {
      title: 'Plugin Documentation — Overview',
      body: `
        <h2>Cognitience WP Extension System</h2>
        <p>Cognitience WP supports a VS Code-inspired extension system. Extensions can add commands, interact with the editor, show notifications, create status bar items, and respond to document lifecycle events.</p>
        <h3>Quick Start</h3>
        <ol>
          <li>Create a folder with a <code>package.json</code> manifest and a <code>main.js</code> entry file</li>
          <li>Define activation events and commands in the manifest</li>
          <li>Implement the <code>activate(context)</code> function in main.js</li>
          <li>Install via Extensions menu → Install from VSIX, or place in the extensions directory</li>
        </ol>
        <h3>Topics</h3>
        <ul>
          <li><strong>Creating an Extension</strong> — step-by-step guide</li>
          <li><strong>Manifest Reference</strong> — all package.json fields</li>
          <li><strong>Extension API Reference</strong> — full context API</li>
          <li><strong>Commands & Menus</strong> — registering commands</li>
          <li><strong>Editor Interaction</strong> — reading/writing editor content</li>
          <li><strong>Lifecycle Events</strong> — activation and deactivation</li>
          <li><strong>Publishing & Distribution</strong> — packaging and sharing</li>
          <li><strong>Example Extension</strong> — complete working example</li>
        </ul>
        <p>Extensions are stored in: <code>AppData/Roaming/cognitience-wp/extensions/</code></p>
      `,
    },
    create: {
      title: 'Plugin Docs — Creating an Extension',
      body: `
        <h2>Creating an Extension</h2>
        <h3>1. Create the folder structure</h3>
        <pre>my-extension/
├── package.json
├── main.js
└── icon.png (optional)</pre>
        <h3>2. Write the manifest (package.json)</h3>
        <pre>{
  "name": "my-extension",
  "displayName": "My Extension",
  "publisher": "myorg",
  "version": "1.0.0",
  "description": "Does something cool",
  "main": "main.js",
  "activationEvents": ["onStartup"],
  "commands": [
    { "id": "sayHello", "title": "Say Hello" }
  ]
}</pre>
        <h3>3. Write the entry file (main.js)</h3>
        <pre>function activate(context) {
  context.commands.registerCommand('sayHello', () => {
    context.notifications.info('Hello from my extension!');
  });
  context.logger.info('Extension activated');
}

function deactivate() {}

module.exports = { activate, deactivate };</pre>
        <h3>4. Install</h3>
        <p>Place the folder in the extensions directory, or zip it and install via Extensions → Install from VSIX.</p>
      `,
    },
    manifest: {
      title: 'Plugin Docs — Manifest Reference',
      body: `
        <h2>package.json Manifest Fields</h2>
        <table>
          <thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td>name</td><td>string</td><td>Yes</td><td>Extension identifier (lowercase, no spaces)</td></tr>
            <tr><td>displayName</td><td>string</td><td>No</td><td>Human-readable name shown in UI</td></tr>
            <tr><td>publisher</td><td>string</td><td>Yes</td><td>Publisher ID</td></tr>
            <tr><td>version</td><td>string</td><td>Yes</td><td>Semver version</td></tr>
            <tr><td>description</td><td>string</td><td>No</td><td>Short description</td></tr>
            <tr><td>main</td><td>string</td><td>Yes</td><td>Entry file path (relative)</td></tr>
            <tr><td>activationEvents</td><td>string[]</td><td>Yes</td><td>When to activate: "onStartup", "*", or custom events</td></tr>
            <tr><td>commands</td><td>array</td><td>No</td><td>Commands to register (id + title)</td></tr>
          </tbody>
        </table>
        <h3>Activation Events</h3>
        <ul>
          <li><code>"onStartup"</code> — activates when Cognitience WP starts</li>
          <li><code>"*"</code> — activates immediately (use sparingly)</li>
        </ul>
      `,
    },
    api: {
      title: 'Plugin Docs — Extension API Reference',
      body: `
        <h2>Extension Context API</h2>
        <p>The <code>activate(context)</code> function receives a context object with:</p>
        <h3>context.extensionId</h3>
        <p>String — the full ID (publisher.name)</p>
        <h3>context.extensionPath</h3>
        <p>String — absolute path to the extension directory</p>
        <h3>context.commands</h3>
        <pre>context.commands.registerCommand(id, handler)
context.commands.executeCommand(id, ...args)
context.commands.getCommands()</pre>
        <h3>context.config</h3>
        <pre>context.config.get('editor.fontSize')
context.config.getAll()</pre>
        <h3>context.notifications</h3>
        <pre>context.notifications.info('message')
context.notifications.warning('message')
context.notifications.error('message')</pre>
        <h3>context.statusBar</h3>
        <pre>const item = context.statusBar.createItem('left', 0);
item.setText('Hello');
item.setTooltip('My extension');
item.show();</pre>
        <h3>context.logger</h3>
        <pre>context.logger.info('...')
context.logger.warn('...')
context.logger.error('...')</pre>
        <h3>context.fs</h3>
        <pre>context.fs.readFileSync('file.txt')
context.fs.writeFileSync('file.txt', 'content')
context.fs.existsSync('file.txt')
context.fs.readDirSync('.')</pre>
      `,
    },
    commands: {
      title: 'Plugin Docs — Commands & Menus',
      body: `
        <h2>Commands</h2>
        <p>Commands are the primary way extensions add functionality. They appear in the Command Palette (Ctrl+Shift+P) and can be triggered by users or called programmatically.</p>
        <h3>Registering a Command</h3>
        <pre>context.commands.registerCommand('myCommand', () => {
  context.notifications.info('Command executed!');
});</pre>
        <p>Command IDs are automatically prefixed with the extension ID if not already qualified. E.g., registering <code>'sayHello'</code> in extension <code>myorg.my-extension</code> becomes <code>myorg.my-extension.sayHello</code>.</p>
        <h3>Executing Commands</h3>
        <pre>await context.commands.executeCommand('otherext.commandId', arg1, arg2);</pre>
        <h3>Manifest Commands</h3>
        <p>Declare commands in package.json to make them visible in the palette:</p>
        <pre>"commands": [
  { "id": "sayHello", "title": "Say Hello" },
  { "id": "formatText", "title": "Format Selected Text" }
]</pre>
      `,
    },
    editor: {
      title: 'Plugin Docs — Editor Interaction',
      body: `
        <h2>Editor Interaction API</h2>
        <h3>Get Editor Content</h3>
        <pre>const html = await context.editor.getContent();</pre>
        <h3>Set Editor Content</h3>
        <pre>context.editor.setContent('&lt;h1&gt;Hello&lt;/h1&gt;');</pre>
        <h3>Get Selection</h3>
        <pre>const sel = await context.editor.getSelection();
// { text: 'selected text', start: 0, end: 12 }</pre>
        <h3>Insert Text at Cursor</h3>
        <pre>context.editor.insertText('Inserted text');</pre>
        <h3>Replace Selection</h3>
        <pre>context.editor.replaceSelection('replacement text');</pre>
        <h3>Scroll To Position</h3>
        <pre>context.editor.scrollTo(500);</pre>
      `,
    },
    events: {
      title: 'Plugin Docs — Lifecycle Events',
      body: `
        <h2>Extension Lifecycle</h2>
        <h3>Activation</h3>
        <p>Extensions activate when their activation events fire. The <code>activate(context)</code> function is called.</p>
        <h3>Document Events</h3>
        <pre>context.documents.onDidOpen((doc) => {
  context.logger.info('Document opened:', doc);
});

context.documents.onDidSave((doc) => {
  context.logger.info('Document saved:', doc);
});

context.documents.onDidChange((changes) => {
  context.logger.info('Document changed');
});</pre>
        <h3>Deactivation</h3>
        <p>Implement <code>deactivate()</code> for cleanup:</p>
        <pre>function deactivate() {
  // Clean up resources
  // Commands are automatically unregistered
}

module.exports = { activate, deactivate };</pre>
      `,
    },
    publish: {
      title: 'Plugin Docs — Publishing & Distribution',
      body: `
        <h2>Publishing Extensions</h2>
        <h3>Packaging</h3>
        <p>Zip your extension folder:</p>
        <pre>my-extension/
├── package.json
├── main.js
└── icon.png</pre>
        <p>Rename the .zip to .cogx for Cognitience Extension format.</p>
        <h3>Installation Methods</h3>
        <ol>
          <li><strong>VSIX Install:</strong> Extensions → Install from VSIX → select .cogx or .zip file</li>
          <li><strong>Manual Install:</strong> Copy the extension folder to <code>AppData/Roaming/cognitience-wp/extensions/</code></li>
          <li><strong>Gallery (coming soon):</strong> Publish to the Cognitience Extension Registry</li>
        </ol>
        <h3>Extension Directory</h3>
        <p>Extensions are stored at: <code>C:\\Users\\[user]\\AppData\\Roaming\\cognitience-wp\\extensions\\</code></p>
        <p>Each extension gets its own subfolder named <code>publisher.name</code>.</p>
      `,
    },
    example: {
      title: 'Plugin Docs — Example Extension',
      body: `
        <h2>Complete Example: Word Counter Extension</h2>
        <h3>package.json</h3>
        <pre>{
  "name": "word-counter",
  "displayName": "Word Counter",
  "publisher": "cognitience",
  "version": "1.0.0",
  "description": "Shows live word count in status bar",
  "main": "main.js",
  "activationEvents": ["onStartup"],
  "commands": [
    { "id": "showCount", "title": "Show Word Count" }
  ]
}</pre>
        <h3>main.js</h3>
        <pre>function activate(context) {
  // Create a status bar item
  const statusItem = context.statusBar.createItem('right', 10);
  statusItem.setText('Words: 0');
  statusItem.show();

  // Register a command
  context.commands.registerCommand('showCount', async () => {
    const content = await context.editor.getContent();
    const text = content.replace(/<[^>]+>/g, ' ');
    const words = text.trim().split(/\\s+/).filter(w => w.length > 0);
    context.notifications.info(words.length + ' words in document');
  });

  // Listen for document changes
  context.documents.onDidChange(() => {
    context.editor.getContent().then(html => {
      const text = html.replace(/<[^>]+>/g, ' ');
      const words = text.trim().split(/\\s+/).filter(w => w.length > 0);
      statusItem.setText('Words: ' + words.length);
    });
  });

  context.logger.info('Word Counter activated');
}

function deactivate() {
  // Status bar item will be disposed automatically
}

module.exports = { activate, deactivate };</pre>
      `,
    },
  };

  const doc = docs[topic];
  if (!doc) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" style="width:700px;max-height:80vh;overflow-y:auto;">
      <div class="modal-header">${doc.title}</div>
      <div class="docs-content" style="font-size:14px;line-height:1.6;color:var(--fg-menu);">${doc.body}</div>
      <div class="modal-buttons">
        <button class="panel-btn primary" id="modal-close-docs">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#modal-close-docs').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ═══════════════════════════════════════════════════════════
// DIALOGS
// ═══════════════════════════════════════════════════════════

function showWordCountDialog() {
  const text = CognitienceWP.editor.innerText;
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const chars = text.length;
  const charsNoSpaces = text.replace(/\s/g, '').length;
  const paragraphs = CognitienceWP.editor.querySelectorAll('p').length;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
  const readingTime = Math.max(1, Math.ceil(words.length / 200));

  showNotification('info', 'Word Count',
    `${words.length} words · ${chars} chars · ${charsNoSpaces} chars (no spaces) · ${paragraphs} paragraphs · ${sentences} sentences · ${readingTime} min read`);
}

function showAboutDialog() {
  const ver = (window.cognitience && window.cognitience.version) || '0.0.0';
  showNotification('info', 'About Cognitience WP',
    `Version ${ver} · The VS Code of word processors · MIT License · Maq-Swarm`);
}

function showShortcutsHelp() {
  const shortcuts = [
    'Ctrl+N: New Document',
    'Ctrl+O: Open File',
    'Ctrl+S: Save',
    'Ctrl+Shift+S: Save As',
    'Ctrl+Z: Undo',
    'Ctrl+Y: Redo',
    'Ctrl+F: Find',
    'Ctrl+H: Replace',
    'Ctrl+B: Bold',
    'Ctrl+Shift+B: Toggle Sidebar',
    'Ctrl+I: Italic',
    'Ctrl+U: Underline',
    'Ctrl+K: Insert Link',
    'Ctrl+1-6: Headings',
    'Ctrl+Shift+P: Command Palette',
    'Ctrl+Shift+F: Focus Mode',
    'Ctrl+Shift+O: Toggle Outline',
    'Ctrl+,: Settings',
    'Ctrl++: Increase Font Size',
    'Ctrl+-: Decrease Font Size',
    'Ctrl+0: Reset Font Size',
    'F11: Full Screen',
    'Ctrl+/: Show Shortcuts',
  ];
  shortcuts.forEach(s => {
    showNotification('info', 'Shortcuts', s);
  });
}

// ═══════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════

function insertTemplate(templateKey) {
  const templates = window.COGNITIENCE_TEMPLATES || {};
  const template = templates[templateKey];
  if (!template) {
    showNotification('error', 'Template Not Found', `Template "${templateKey}" does not exist.`);
    return;
  }

  if (templateKey === 'blank') {
    newDocument();
    return;
  }

  if (CognitienceWP.isDirty || CognitienceWP.editor.innerText.trim().length > 0) {
    if (!confirm(`Insert the "${template.name}" template? This will replace your current document content.`)) {
      return;
    }
  }

  CognitienceWP.editor.innerHTML = template.insert();
  CognitienceWP.docTitle = template.name;
  updateDocTitle(template.name);
  markDirty();
  updateWordCount();
  updateOutline();
  CognitienceWP.editor.focus();
  showNotification('success', 'Template Inserted', `"${template.name}" template loaded.`);
}

// ═══════════════════════════════════════════════════════════
// SPELLCHECK (manual — SymSpell + underline on demand)
// ═══════════════════════════════════════════════════════════

let lastSpellContextForFix = null;

function initSpellChecker() {
  if (typeof window.SymSpell !== 'function') {
    console.warn('[Cognitience WP] SymSpell not loaded');
    return;
  }
  CognitienceWP.spellChecker = new window.SymSpell(2);
  CognitienceWP.spellChecker.loadDefault();
  const customWords = CognitienceWP.config['editor.customDictionary'] || [];
  for (const w of customWords) {
    CognitienceWP.spellChecker.addCustomWord(w);
  }
  if (CognitienceWP.editor) {
    CognitienceWP.editor.spellcheck = false;
    CognitienceWP.editor.setAttribute('spellcheck', 'false');
  }
  console.log('[Cognitience WP] Manual spellcheck ready (click Spellcheck to underline errors)');
}

function runDocumentSpellcheck() {
  if (!CognitienceWP.spellChecker || !window.SpellManual) {
    showNotification('error', 'Spellcheck', 'Spellchecker is not available.');
    return;
  }
  const editor = CognitienceWP.editor;
  editor.focus();
  const { count } = window.SpellManual.runManualSpellcheck(editor, CognitienceWP.spellChecker);
  if (count === 0) {
    showNotification('success', 'Spellcheck', 'No misspelled words found.');
  } else {
    showNotification('info', 'Spellcheck', `Underlined ${count} misspelled word${count === 1 ? '' : 's'}.`);
  }
}

function spellCtxToMenu(ctx) {
  if (!ctx || !ctx.misspelledWord) return null;
  return {
    word: ctx.misspelledWord,
    suggestions: ctx.suggestions || [],
  };
}

function applySpellingFix(newWord) {
  const ctx = lastSpellContextForFix;
  if (!ctx || !ctx.misspelledWord) return;

  CognitienceWP.editor.focus();

  const replaceFn = window.SpellReplace && window.SpellReplace.replaceMisspelledWord;
  const ok = replaceFn
    ? replaceFn(CognitienceWP.editor, ctx.misspelledWord, newWord, {
        range: ctx.savedRange || null,
        x: ctx.x,
        y: ctx.y,
      })
    : false;
  if (!ok) return;

  if (window.SpellManual) {
    window.SpellManual.clearMisspelledMarks(CognitienceWP.editor);
  }
  markDirty();
  showNotification('info', 'Spellcheck', `Applied: ${newWord}`);
  lastSpellContextForFix = null;
}

async function addWordToDictionary(word) {
  if (!word) return;

  word = word.trim();
  if (CognitienceWP.spellChecker) {
    CognitienceWP.spellChecker.addCustomWord(word);
  }

  const customWords = CognitienceWP.config['editor.customDictionary'] || [];
  if (!customWords.includes(word)) {
    customWords.push(word);
    window.cognitience.config.set('editor.customDictionary', customWords);
    CognitienceWP.config['editor.customDictionary'] = customWords;
  }

  if (window.SpellManual) {
    window.SpellManual.clearMisspelledMarks(CognitienceWP.editor);
  }
  showNotification('success', 'Dictionary', `Added "${word}" to dictionary`);
  lastSpellContextForFix = null;
}

// ═══════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
