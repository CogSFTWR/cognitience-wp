(() => {
  'use strict';

  const API = '/api';
  const editor = document.getElementById('editor');
  const mdRaw = document.getElementById('md-raw');
  const pdfViewer = document.getElementById('pdf-viewer');
  const pdfFrame = document.getElementById('pdf-frame');
  const pdfPages = document.getElementById('pdf-pages');
  const pdfPageLabel = document.getElementById('pdf-page-label');
  const pdfPrev = document.getElementById('pdf-prev');
  const pdfNext = document.getElementById('pdf-next');
  const pdfZoomIn = document.getElementById('pdf-zoom-in');
  const pdfZoomOut = document.getElementById('pdf-zoom-out');
  const docTitle = document.getElementById('doc-title');
  let pdfObjectUrl = null;
  let pdfDoc = null;
  let pdfPageNum = 1;
  let pdfScale = 1.15;
  let pdfRenderToken = 0;
  const statusText = document.getElementById('status-text');
  const fmtBtns = document.querySelectorAll('.fmt');
  const alignBtns = document.querySelectorAll('.align');
  const colorBtn = document.getElementById('color-btn');
  const highlightBtn = document.getElementById('highlight-btn');
  const picker = document.getElementById('picker');
  const hlPicker = document.getElementById('hl-picker');
  const colBar = document.getElementById('col-bar');
  const hlBar = document.getElementById('hl-bar');
  const textColors = document.getElementById('text-colors');
  const hlColors = document.getElementById('hl-colors');
  const hlNone = document.getElementById('hl-none');
  const fsMinus = document.getElementById('fs-minus');
  const fsPlus = document.getElementById('fs-plus');
  const fsVal = document.getElementById('fs-val');
  const floatTb = document.getElementById('floating-toolbar');
  const textLoupe = document.getElementById('text-loupe');
  const textLoupeContent = document.getElementById('text-loupe-content');
  const starBtn = document.getElementById('star-btn');
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  const printBtn = document.getElementById('print-btn');
  const saveBtn = document.getElementById('save-btn');
  const sidebarNew = document.getElementById('sidebar-new');
  const sidebarOpen = document.getElementById('sidebar-open');
  const docList = document.getElementById('doc-list');
  const fontBtn = document.getElementById('font-btn');
  const fontMenu = document.getElementById('font-menu');
  const fontLabel = document.getElementById('font-label');
  const styleBtn = document.getElementById('style-btn');
  const styleMenu = document.getElementById('style-menu');
  const styleLabel = document.getElementById('style-label');
  const spacingBtn = document.getElementById('spacing-btn');
  const spacingMenu = document.getElementById('spacing-menu');
  const linkBtn = document.getElementById('link-btn');
  const imageBtn = document.getElementById('image-btn');
  const imageInput = document.getElementById('image-input');
  const fileOpenInput = document.getElementById('file-open-input');
  const linkDialog = document.getElementById('link-dialog');
  const linkText = document.getElementById('link-text');
  const linkUrl = document.getElementById('link-url');
  const linkApply = document.getElementById('link-apply');
  const mdToggle = document.getElementById('md-toggle');
  const mdToggleLabel = document.getElementById('md-toggle-label');
  const marginLeft = document.getElementById('margin-left');
  const marginRight = document.getElementById('margin-right');
  const paper = document.getElementById('paper');
  const docsFolderLabel = document.getElementById('docs-folder-label');
  const insertBtn = document.getElementById('insert-btn');
  const insertMenu = document.getElementById('insert-menu');
  const chartDialog = document.getElementById('chart-dialog');
  const chartData = document.getElementById('chart-data');
  const chartApply = document.getElementById('chart-apply');
  const chartTitle = document.getElementById('chart-dialog-title');
  const drawDialog = document.getElementById('draw-dialog');
  const drawCanvas = document.getElementById('draw-canvas');
  const drawApply = document.getElementById('draw-apply');
  const drawClear = document.getElementById('draw-clear');
  const drawColor = document.getElementById('draw-color');
  const drawSize = document.getElementById('draw-size');
  let pendingChartType = 'pie';

  // Google Docs–style palette (from screenshot)
  const TEXT_PALETTE = [
    '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
    '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
    '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
    '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
    '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0',
    '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
    '#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47',
    '#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130',
  ];
  const HL_PALETTE = TEXT_PALETTE.filter((c) => c.toLowerCase() !== '#ffffff');

  let currentPt = 12;
  let currentColor = '#000000';
  let currentHighlight = '#ffff00';
  let currentFont = 'Inter';
  let currentSpacing = 1.5;
  let marginL = 72; // px (~1")
  let marginR = 72;
  let docId = null;
  let filePath = null;
  let dirty = false;
  let saveTimer = null;
  let starred = false;
  let mdSource = null;
  let mdRawMode = false;
  let activeFilePath = null;

  // ── Helpers ────────────────────────────────────────────
  function exec(cmd, val = null) {
    editor.focus();
    try {
      document.execCommand(cmd, false, val);
    } catch {
      /* ignore */
    }
    markDirty();
    sync();
  }

  function placeCaretAtEnd(el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function rgbToHex(rgb) {
    if (!rgb) return '#000000';
    if (rgb.startsWith('#')) {
      const h = rgb.slice(1);
      if (h.length === 3) {
        return (
          '#' +
          h
            .split('')
            .map((c) => c + c)
            .join('')
        ).toLowerCase();
      }
      return ('#' + h).toLowerCase().slice(0, 7);
    }
    if (rgb === 'transparent') return 'transparent';
    const m = rgb.match(/\d+/g);
    if (!m || m.length < 3) return '#000000';
    return (
      '#' +
      m
        .slice(0, 3)
        .map((n) => (+n).toString(16).padStart(2, '0'))
        .join('')
    );
  }

  function wrapSelection(styles) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement('span');
    Object.assign(span.style, styles);
    if (range.collapsed) {
      span.appendChild(document.createTextNode('\u200B'));
      range.insertNode(span);
      const nr = document.createRange();
      nr.setStart(span.firstChild, 1);
      nr.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nr);
      return;
    }
    try {
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    } catch {
      try {
        range.surroundContents(span);
      } catch {
        /* ignore */
      }
    }
    const nr = document.createRange();
    nr.selectNodeContents(span);
    nr.collapse(false);
    sel.removeAllRanges();
    sel.addRange(nr);
  }

  function setStatus(text, kind = '') {
    statusText.textContent = text;
    statusText.classList.remove('saving', 'error');
    if (kind) statusText.classList.add(kind);
  }

  function markDirty() {
    dirty = true;
    setStatus('Unsaved changes', 'saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveDocument({ quiet: true });
    }, 1400);
  }

  function setTitle(raw) {
    const title = (raw || '').trim() || 'Untitled document';
    document.title = `${title} — Cognition WP`;
  }

  function closeMenus() {
    [picker, hlPicker, fontMenu, styleMenu, spacingMenu, insertMenu].forEach((el) => {
      if (!el) return;
      el.classList.add('hidden');
      el.setAttribute('aria-hidden', 'true');
    });
    colorBtn.setAttribute('aria-expanded', 'false');
    highlightBtn.setAttribute('aria-expanded', 'false');
    fontBtn.setAttribute('aria-expanded', 'false');
    styleBtn.setAttribute('aria-expanded', 'false');
    spacingBtn.setAttribute('aria-expanded', 'false');
    if (insertBtn) insertBtn.setAttribute('aria-expanded', 'false');
  }

  function insertNodeAtCaret(node) {
    editor.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.collapse(false);
      range.insertNode(node);
      const after = document.createElement('p');
      after.innerHTML = '<br>';
      if (node.parentNode) {
        if (node.nextSibling) node.parentNode.insertBefore(after, node.nextSibling);
        else node.parentNode.appendChild(after);
      }
      range.setStart(after, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editor.appendChild(node);
    }
    markDirty();
  }

  function parseChartRows(text) {
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const parts = l.split(/[,:\t]/);
        const label = (parts[0] || '').trim() || 'Item';
        const value = parseFloat((parts[1] || '0').replace(/[^0-9.\-]/g, '')) || 0;
        return { label, value: Math.max(0, value) };
      })
      .filter((r) => r.value > 0 || r.label);
  }

  function chartColors() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return dark
      ? ['#f5f5f7', '#c7c7cc', '#8e8e93', '#636366', '#aeaeb2', '#48484a', '#d1d1d6', '#3a3a3c']
      : ['#1d1d1f', '#555555', '#888888', '#aaaaaa', '#333333', '#666666', '#999999', '#222222'];
  }

  function buildPieCanvas(rows) {
    const c = document.createElement('canvas');
    c.width = 360;
    c.height = 280;
    c.className = 'embed-block';
    const ctx = c.getContext('2d');
    const total = rows.reduce((s, r) => s + r.value, 0) || 1;
    let a0 = -Math.PI / 2;
    const cx = 140;
    const cy = 140;
    const R = 100;
    rows.forEach((r, i) => {
      const a1 = a0 + (r.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a1);
      ctx.closePath();
      const colors = chartColors();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      a0 = a1;
    });
    // legend
    const colors = chartColors();
    const ink = document.documentElement.getAttribute('data-theme') === 'dark' ? '#f5f5f7' : '#1d1d1f';
    rows.forEach((r, i) => {
      const y = 24 + i * 22;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(260, y - 10, 12, 12);
      ctx.fillStyle = ink;
      ctx.font = '12px Inter, sans-serif';
      ctx.fillText(`${r.label} (${r.value})`, 278, y);
    });
    return c;
  }

  function buildBarCanvas(rows) {
    const c = document.createElement('canvas');
    c.width = 420;
    c.height = 260;
    c.className = 'embed-block';
    const ctx = c.getContext('2d');
    const colors = chartColors();
    const ink = document.documentElement.getAttribute('data-theme') === 'dark' ? '#f5f5f7' : '#1d1d1f';
    const max = Math.max(...rows.map((r) => r.value), 1);
    const pad = 40;
    const bw = (c.width - pad * 2) / rows.length;
    ctx.strokeStyle = document.documentElement.getAttribute('data-theme') === 'dark' ? '#48484a' : '#ccc';
    ctx.beginPath();
    ctx.moveTo(pad, 20);
    ctx.lineTo(pad, c.height - 30);
    ctx.lineTo(c.width - 10, c.height - 30);
    ctx.stroke();
    rows.forEach((r, i) => {
      const h = ((c.height - 50) * r.value) / max;
      const x = pad + i * bw + bw * 0.15;
      const y = c.height - 30 - h;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(x, y, bw * 0.7, h);
      ctx.fillStyle = ink;
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText(r.label.slice(0, 8), x, c.height - 12);
    });
    return c;
  }

  function buildLineCanvas(rows) {
    const c = document.createElement('canvas');
    c.width = 420;
    c.height = 260;
    c.className = 'embed-block';
    const ctx = c.getContext('2d');
    const ink = document.documentElement.getAttribute('data-theme') === 'dark' ? '#f5f5f7' : '#1d1d1f';
    const max = Math.max(...rows.map((r) => r.value), 1);
    const pad = 40;
    const step = rows.length > 1 ? (c.width - pad * 2) / (rows.length - 1) : 0;
    ctx.strokeStyle = document.documentElement.getAttribute('data-theme') === 'dark' ? '#48484a' : '#ccc';
    ctx.beginPath();
    ctx.moveTo(pad, 20);
    ctx.lineTo(pad, c.height - 30);
    ctx.lineTo(c.width - 10, c.height - 30);
    ctx.stroke();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    rows.forEach((r, i) => {
      const x = pad + i * step;
      const y = c.height - 30 - ((c.height - 50) * r.value) / max;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    rows.forEach((r, i) => {
      const x = pad + i * step;
      const y = c.height - 30 - ((c.height - 50) * r.value) / max;
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText(r.label.slice(0, 8), x - 12, c.height - 12);
    });
    return c;
  }

  function insertSheet() {
    const table = document.createElement('table');
    table.className = 'embed-sheet embed-block';
    table.setAttribute('contenteditable', 'true');
    for (let r = 0; r < 4; r++) {
      const tr = document.createElement('tr');
      for (let c = 0; c < 4; c++) {
        const cell = document.createElement(r === 0 ? 'th' : 'td');
        cell.textContent = r === 0 ? String.fromCharCode(65 + c) : '';
        if (r === 0 && c === 0) cell.textContent = '';
        tr.appendChild(cell);
      }
      table.appendChild(tr);
    }
    insertNodeAtCaret(table);
  }

  function insertDivider() {
    const hr = document.createElement('hr');
    hr.className = 'embed-divider';
    insertNodeAtCaret(hr);
  }

  function openChartDialog(type) {
    pendingChartType = type;
    const titles = { pie: 'Pie chart', bar: 'Bar graph', line: 'Line graph' };
    chartTitle.textContent = titles[type] || 'Chart';
    chartDialog.classList.remove('hidden');
    chartData.focus();
  }

  function applyChart() {
    const rows = parseChartRows(chartData.value);
    if (!rows.length) {
      setStatus('Add at least one data row', 'error');
      return;
    }
    let canvas;
    if (pendingChartType === 'bar') canvas = buildBarCanvas(rows);
    else if (pendingChartType === 'line') canvas = buildLineCanvas(rows);
    else canvas = buildPieCanvas(rows);
    // Convert to img so it survives contenteditable better
    const img = document.createElement('img');
    img.className = 'embed-block';
    img.alt = pendingChartType + ' chart';
    img.src = canvas.toDataURL('image/png');
    insertNodeAtCaret(img);
    chartDialog.classList.add('hidden');
  }

  // Drawing
  let drawing = false;
  let lastPt = null;
  function initDraw() {
    const ctx = drawCanvas.getContext('2d');
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    ctx.fillStyle = dark ? '#1c1c1e' : '#ffffff';
    ctx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (drawColor) drawColor.value = dark ? '#f5f5f7' : '#1d1d1f';
  }
  function canvasPos(e) {
    const r = drawCanvas.getBoundingClientRect();
    const scaleX = drawCanvas.width / r.width;
    const scaleY = drawCanvas.height / r.height;
    return {
      x: (e.clientX - r.left) * scaleX,
      y: (e.clientY - r.top) * scaleY,
    };
  }
  drawCanvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    lastPt = canvasPos(e);
    drawCanvas.setPointerCapture(e.pointerId);
  });
  drawCanvas.addEventListener('pointermove', (e) => {
    if (!drawing || !lastPt) return;
    const p = canvasPos(e);
    const ctx = drawCanvas.getContext('2d');
    ctx.strokeStyle = drawColor.value;
    ctx.lineWidth = Number(drawSize.value) || 3;
    ctx.beginPath();
    ctx.moveTo(lastPt.x, lastPt.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPt = p;
  });
  drawCanvas.addEventListener('pointerup', () => {
    drawing = false;
    lastPt = null;
  });
  drawClear.addEventListener('click', () => initDraw());
  drawApply.addEventListener('click', () => {
    const img = document.createElement('img');
    img.className = 'embed-block';
    img.alt = 'Drawing';
    img.src = drawCanvas.toDataURL('image/png');
    insertNodeAtCaret(img);
    drawDialog.classList.add('hidden');
  });

  async function exportAs(format) {
    if (mdRawMode) {
      mdSource = mdRaw.value;
      editor.innerHTML = clientMarkdownToHtml(mdSource);
    }
    const title = (docTitle.textContent || '').trim() || 'document';
    try {
      setStatus('Exporting…', 'saving');
      const res = await fetch(API + '/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          title,
          html: editor.innerHTML,
          markdown: mdSource,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText);
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      let filename = title + '.' + format;
      const m = cd.match(/filename=\"([^\"]+)\"/);
      if (m) filename = m[1];
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      setStatus('Exported ' + filename);
    } catch (e) {
      setStatus(e.message || 'Export failed', 'error');
    }
  }

  function buildPalette(container, colors, onPick, activeHex) {
    container.innerHTML = '';
    colors.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.c = c;
      b.style.background = c;
      b.title = c;
      b.setAttribute('aria-label', c);
      if (c.toLowerCase() === '#ffffff') b.style.boxShadow = 'inset 0 0 0 1px #ccc';
      if (rgbToHex(c) === rgbToHex(activeHex)) b.classList.add('active-ring');
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => onPick(c));
      container.appendChild(b);
    });
  }

  function setActiveColor(hex) {
    currentColor = hex;
    colBar.style.background = hex;
  }

  function setActiveHighlight(hex) {
    currentHighlight = hex === 'transparent' ? '#ffff00' : hex;
    hlBar.style.background = hex === 'transparent' ? '#e5e5ea' : hex;
  }

  function applyHighlight(color) {
    editor.focus();
    try {
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('hiliteColor', false, color);
    } catch {
      /* ignore */
    }
    if (color === 'transparent') wrapSelection({ backgroundColor: 'transparent' });
    else wrapSelection({ backgroundColor: color });
    setActiveHighlight(color === 'transparent' ? 'transparent' : color);
    markDirty();
    sync();
  }

  function applyFont(family) {
    currentFont = family;
    fontLabel.textContent = family;
    exec('fontName', family);
    wrapSelection({ fontFamily: family });
  }

  function applyFontSize(pt) {
    const n = Math.max(6, Math.min(200, Math.round(Number(pt) || 12)));
    currentPt = n;
    fsVal.value = String(n);
    wrapSelection({ fontSize: n + 'pt' });
    markDirty();
  }

  function applyLineSpacing(sp) {
    currentSpacing = Number(sp) || 1.5;
    editor.style.lineHeight = String(currentSpacing);
    spacingMenu.querySelectorAll('.menu-option').forEach((o) => {
      o.classList.toggle('active', o.dataset.spacing === String(currentSpacing));
    });
    markDirty();
  }

  function applyStyle(tag) {
    const map = {
      p: 'Normal text',
      h1: 'Heading 1',
      h2: 'Heading 2',
      h3: 'Heading 3',
      h4: 'Heading 4',
      h5: 'Heading 5',
      h6: 'Heading 6',
    };
    styleLabel.textContent = map[tag] || 'Normal text';
    editor.focus();
    try {
      document.execCommand('formatBlock', false, tag === 'p' ? 'p' : tag);
    } catch {
      /* ignore */
    }
    markDirty();
    closeMenus();
  }

  function applyMargins() {
    editor.style.paddingLeft = marginL + 'px';
    editor.style.paddingRight = marginR + 'px';
    const track = document.getElementById('ruler-track');
    if (!track) return;
    const w = track.clientWidth || 816;
    marginLeft.style.left = (marginL / w) * 100 + '%';
    marginRight.style.right = (marginR / w) * 100 + '%';
  }

  // ── Liquid Glass text loupe (selection magnifier) ───────
  const LOUPE_SCALE = 1.65;
  const LOUPE_SIZE = 120;
  const LOUPE_DRAG_THRESHOLD = 5;
  let loupeDragging = false;
  let loupeActive = false;
  let loupeRaf = 0;
  let loupeLastX = 0;
  let loupeLastY = 0;
  let loupeOriginX = 0;
  let loupeOriginY = 0;
  let loupeCloneDirty = true;

  function loupeAllowed() {
    if (!textLoupe || !textLoupeContent) return false;
    try {
      if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return false;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    } catch {
      /* ignore */
    }
    return true;
  }

  function refreshLoupeClone() {
    if (!textLoupeContent || !editor) return;
    textLoupeContent.innerHTML = editor.innerHTML || '&nbsp;';
    textLoupeContent.style.width = editor.clientWidth + 'px';
    textLoupeContent.style.minHeight = editor.clientHeight + 'px';
    textLoupeContent.style.padding = getComputedStyle(editor).padding;
    textLoupeContent.style.font = getComputedStyle(editor).font;
    textLoupeContent.style.lineHeight = getComputedStyle(editor).lineHeight;
    textLoupeContent.style.letterSpacing = getComputedStyle(editor).letterSpacing;
    textLoupeContent.style.whiteSpace = 'pre-wrap';
    textLoupeContent.style.wordBreak = 'break-word';
    textLoupeContent.style.boxSizing = 'border-box';
    textLoupeContent.style.setProperty('--loupe-scale', String(LOUPE_SCALE));
    loupeCloneDirty = false;
  }

  function positionLoupe(clientX, clientY) {
    if (!loupeAllowed()) return;
    const half = LOUPE_SIZE / 2;
    const editorRect = editor.getBoundingClientRect();
    // Focus in editor local coords (content under the pointer)
    const focusX = clientX - editorRect.left;
    const focusY = clientY - editorRect.top;

    if (loupeCloneDirty) refreshLoupeClone();

    // Place magnified content so focus sits at loupe center
    const off =
      window.CognitionLiquidGlass && window.CognitionLiquidGlass.loupeContentOffset
        ? window.CognitionLiquidGlass.loupeContentOffset(focusX, focusY, LOUPE_SIZE, LOUPE_SCALE)
        : { tx: half - focusX * LOUPE_SCALE, ty: half - focusY * LOUPE_SCALE, scale: LOUPE_SCALE };
    textLoupeContent.style.transform =
      'translate3d(' + off.tx + 'px,' + off.ty + 'px,0) scale(' + off.scale + ')';

    textLoupe.style.left = clientX + 'px';
    textLoupe.style.top = clientY + 'px';
    textLoupe.classList.add('is-visible');
    textLoupe.setAttribute('aria-hidden', 'false');
  }

  function hideLoupe() {
    if (!textLoupe) return;
    textLoupe.classList.remove('is-visible');
    textLoupe.setAttribute('aria-hidden', 'true');
  }

  function scheduleLoupe(clientX, clientY) {
    loupeLastX = clientX;
    loupeLastY = clientY;
    if (loupeRaf) return;
    loupeRaf = requestAnimationFrame(() => {
      loupeRaf = 0;
      if (!loupeDragging) return;
      if (!loupeActive) {
        const dx = loupeLastX - loupeOriginX;
        const dy = loupeLastY - loupeOriginY;
        if (dx * dx + dy * dy < LOUPE_DRAG_THRESHOLD * LOUPE_DRAG_THRESHOLD) return;
        loupeActive = true;
      }
      // Keep loupe over the editor surface only
      const r = editor.getBoundingClientRect();
      if (
        loupeLastX < r.left - 8 ||
        loupeLastX > r.right + 8 ||
        loupeLastY < r.top - 8 ||
        loupeLastY > r.bottom + 8
      ) {
        hideLoupe();
        return;
      }
      positionLoupe(loupeLastX, loupeLastY);
    });
  }

  // ── Sync toolbar ───────────────────────────────────────
  function sync() {
    try {
      fmtBtns.forEach((b) => {
        const on = document.queryCommandState(b.dataset.cmd);
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      let align = 'left';
      if (document.queryCommandState('justifyFull')) align = 'justify';
      else if (document.queryCommandState('justifyCenter')) align = 'center';
      else if (document.queryCommandState('justifyRight')) align = 'right';
      alignBtns.forEach((b) => {
        const on = b.dataset.align === align;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && editor.contains(sel.anchorNode)) {
        floatTb.classList.remove('hidden');
        try {
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const paperRect = paper.getBoundingClientRect();
          const layout =
            window.CognitionLiquidGlass && window.CognitionLiquidGlass.floatingToolbarLayout
              ? window.CognitionLiquidGlass.floatingToolbarLayout(rect, paperRect, {
                  barHeight: 44,
                  gap: 10,
                  pad: 12,
                  halfWidth: Math.min(100, paperRect.width / 2 - 12),
                })
              : {
                  left: rect.left + rect.width / 2 - paperRect.left,
                  top: Math.max(8, rect.top - paperRect.top - 54),
                };
          floatTb.style.left = layout.left + 'px';
          floatTb.style.top = layout.top + 'px';
          floatTb.style.right = 'auto';
        } catch {
          /* ignore */
        }
      } else {
        floatTb.classList.add('hidden');
      }
    } catch {
      /* ignore */
    }
  }

  // ── API ────────────────────────────────────────────────
  async function api(path, options = {}) {
    const res = await fetch(API + path, {
      headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
    return data;
  }

  async function refreshFileList() {
    try {
      const list = await api('/files');
      docList.innerHTML = '';
      if (!list.length) {
        const empty = document.createElement('p');
        empty.className = 'tabs-hint';
        empty.textContent = 'No documents found. Use Open Document or New Document.';
        docList.appendChild(empty);
        return;
      }
      list.forEach((f) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'doc-item pressable' + (activeFilePath === f.path ? ' active' : '');
        const icon =
          f.kind === 'markdown'
            ? 'draft'
            : f.kind === 'word'
              ? 'description'
              : f.kind === 'pdf'
                ? 'picture_as_pdf'
                : 'article';
        btn.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${icon}</span><span class="doc-item-title"></span><span class="doc-ext"></span>`;
        btn.querySelector('.doc-item-title').textContent = f.name;
        btn.querySelector('.doc-ext').textContent = f.ext;
        btn.title = f.path;
        btn.addEventListener('click', () => openServerPath(f.path));
        docList.appendChild(btn);
      });
    } catch (e) {
      console.warn(e);
      setStatus('Could not list Documents', 'error');
    }
  }

  function setMarkdownMode(enabled, source) {
    if (enabled) {
      mdSource = source != null ? source : mdSource || '';
      mdToggle.classList.remove('hidden');
      mdRawMode = false;
      mdToggle.setAttribute('aria-pressed', 'false');
      mdToggleLabel.textContent = 'Rendered MD';
      mdRaw.classList.add('hidden');
      editor.classList.remove('hidden');
    } else {
      mdSource = null;
      mdToggle.classList.add('hidden');
      mdRaw.classList.add('hidden');
      editor.classList.remove('hidden');
      mdRawMode = false;
    }
  }

  function toggleMarkdownView() {
    if (mdSource == null) return;
    mdRawMode = !mdRawMode;
    mdToggle.setAttribute('aria-pressed', mdRawMode ? 'true' : 'false');
    if (mdRawMode) {
      mdToggleLabel.textContent = 'Raw MD';
      mdRaw.value = mdSource;
      mdRaw.classList.remove('hidden');
      editor.classList.add('hidden');
      mdRaw.focus();
    } else {
      // Leaving raw: re-render from textarea
      mdSource = mdRaw.value;
      mdToggleLabel.textContent = 'Rendered MD';
      mdRaw.classList.add('hidden');
      editor.classList.remove('hidden');
      // Simple client re-render via backend-compatible subset
      editor.innerHTML = clientMarkdownToHtml(mdSource);
      markDirty();
    }
  }

  function clientMarkdownToHtml(md) {
    // Lightweight mirror of backend (enough for toggle)
    const lines = md.split('\n');
    let html = '';
    let ul = false;
    let ol = false;
    const close = () => {
      if (ul) {
        html += '</ul>';
        ul = false;
      }
      if (ol) {
        html += '</ol>';
        ol = false;
      }
    };
    const inline = (s) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
    for (const line of lines) {
      const t = line.trimEnd();
      if (!t.trim()) {
        close();
        continue;
      }
      if (t.startsWith('### ')) {
        close();
        html += `<h3>${inline(t.slice(4))}</h3>`;
      } else if (t.startsWith('## ')) {
        close();
        html += `<h2>${inline(t.slice(3))}</h2>`;
      } else if (t.startsWith('# ')) {
        close();
        html += `<h1>${inline(t.slice(2))}</h1>`;
      } else if (t.startsWith('- ') || t.startsWith('* ')) {
        if (ol) {
          html += '</ol>';
          ol = false;
        }
        if (!ul) {
          html += '<ul>';
          ul = true;
        }
        html += `<li>${inline(t.slice(2))}</li>`;
      } else if (/^\d+\.\s/.test(t)) {
        if (ul) {
          html += '</ul>';
          ul = false;
        }
        if (!ol) {
          html += '<ol>';
          ol = true;
        }
        html += `<li>${inline(t.replace(/^\d+\.\s/, ''))}</li>`;
      } else {
        close();
        html += `<p>${inline(t)}</p>`;
      }
    }
    close();
    return html || '<p></p>';
  }

  async function openServerPath(path) {
    try {
      setStatus('Opening…', 'saving');
      const doc = await api('/files/open', { method: 'POST', body: JSON.stringify({ path }) });
      loadOpened(doc);
    } catch (e) {
      setStatus(e.message || 'Open failed', 'error');
    }
  }

  function clearPdfView() {
    pdfRenderToken += 1;
    if (pdfPages && pdfPages._pdfIo) {
      try {
        pdfPages._pdfIo.disconnect();
      } catch {
        /* ignore */
      }
      pdfPages._pdfIo = null;
    }
    if (pdfObjectUrl) {
      try {
        URL.revokeObjectURL(pdfObjectUrl);
      } catch {
        /* ignore */
      }
      pdfObjectUrl = null;
    }
    pdfDoc = null;
    pdfPageNum = 1;
    pdfScale = 1.15;
    if (pdfPages) pdfPages.innerHTML = '';
    if (pdfFrame) {
      pdfFrame.src = 'about:blank';
      pdfFrame.classList.add('hidden');
    }
    if (pdfViewer) pdfViewer.classList.add('hidden');
    if (paper) paper.classList.remove('pdf-mode');
    document.body.classList.remove('pdf-open');
    editor.classList.remove('hidden');
  }

  function updatePdfPageLabel() {
    if (!pdfPageLabel || !pdfDoc) return;
    const total = pdfDoc.numPages;
    pdfPageLabel.textContent = 'Page ' + pdfPageNum + ' / ' + total;
    if (pdfPrev) pdfPrev.disabled = pdfPageNum <= 1;
    if (pdfNext) pdfNext.disabled = pdfPageNum >= total;
  }

  async function renderAllPdfPages() {
    if (!pdfDoc || !pdfPages) return;
    const token = ++pdfRenderToken;
    const total = pdfDoc.numPages || 0;
    if (total < 1) {
      pdfPages.innerHTML = '<p class="tabs-hint">This PDF has no pages.</p>';
      return;
    }

    pdfPages.innerHTML = '';
    const frag = document.createDocumentFragment();
    const tasks = [];

    for (let i = 1; i <= total; i++) {
      if (token !== pdfRenderToken) return;
      const page = await pdfDoc.getPage(i);
      if (token !== pdfRenderToken) return;
      const viewport = page.getViewport({ scale: pdfScale });
      const wrap = document.createElement('div');
      wrap.className = 'pdf-page';
      wrap.id = 'pdf-page-' + i;
      wrap.dataset.page = String(i);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: false });
      // High-DPI crisp render
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = Math.floor(viewport.width) + 'px';
      canvas.style.height = Math.floor(viewport.height) + 'px';
      canvas.setAttribute('aria-label', 'Page ' + i + ' of ' + total);
      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
      wrap.appendChild(canvas);
      frag.appendChild(wrap);
      tasks.push(
        page.render({
          canvasContext: ctx,
          viewport,
          transform: transform || undefined,
        }).promise
      );
    }

    pdfPages.appendChild(frag);
    await Promise.all(tasks);
    if (token !== pdfRenderToken) return;

    pdfPageNum = Math.min(Math.max(1, pdfPageNum), total);
    updatePdfPageLabel();
    // Observe which page is in view while scrolling
    if ('IntersectionObserver' in window) {
      const pages = pdfPages.querySelectorAll('.pdf-page');
      const io = new IntersectionObserver(
        (entries) => {
          let best = null;
          let bestRatio = 0;
          entries.forEach((en) => {
            if (en.isIntersecting && en.intersectionRatio > bestRatio) {
              bestRatio = en.intersectionRatio;
              best = en.target;
            }
          });
          if (best && best.dataset.page) {
            pdfPageNum = Number(best.dataset.page) || pdfPageNum;
            updatePdfPageLabel();
          }
        },
        { root: pdfPages, threshold: [0.35, 0.55, 0.75] }
      );
      pages.forEach((p) => io.observe(p));
      pdfPages._pdfIo = io;
    }
  }

  function scrollToPdfPage(n) {
    if (!pdfPages) return;
    const el = document.getElementById('pdf-page-' + n) || pdfPages.querySelector('.pdf-page[data-page="' + n + '"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /**
   * @param {string | { kind: string, value: any } | null} source
   *   URL string, or resolved { kind: 'url'|'data', value } from CognitionPdf.resolvePdfSource
   */
  async function showPdfView(source) {
    setMarkdownMode(false);
    floatTb.classList.add('hidden');
    document.body.classList.add('pdf-open');
    if (pdfViewer) {
      pdfViewer.classList.remove('hidden');
    }
    if (pdfFrame) {
      pdfFrame.classList.add('hidden');
      pdfFrame.src = 'about:blank';
    }
    if (pdfPages) pdfPages.innerHTML = '<p class="tabs-hint">Loading PDF…</p>';

    const helpers = window.CognitionPdf;
    let resolved =
      source && typeof source === 'object' && source.kind
        ? source
        : typeof source === 'string'
          ? { kind: 'url', value: source }
          : null;

    // pdf.js — render ALL pages into a scrollable stack
    if (window.pdfjsLib && resolved) {
      try {
        const workerSrc = helpers
          ? helpers.pdfWorkerSrc(window.location.href)
          : new URL('vendor/pdf.worker.min.js', window.location.href).href;
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

        const docOpts = helpers
          ? helpers.getDocumentOptions(resolved)
          : resolved.kind === 'data'
            ? { data: resolved.value }
            : { url: resolved.value, withCredentials: false };

        const loadingTask = window.pdfjsLib.getDocument(docOpts);
        pdfDoc = await loadingTask.promise;
        pdfPageNum = 1;
        const srcLog =
          resolved.kind === 'url'
            ? String(resolved.value).slice(0, 80)
            : 'data[' + (resolved.value && resolved.value.length) + ']';
        console.info('[pdf] loaded pages=', pdfDoc.numPages, 'src=', srcLog);
        await renderAllPdfPages();
        return;
      } catch (e) {
        console.warn('pdf.js render failed, falling back to embed', e);
        if (pdfPages) {
          pdfPages.innerHTML =
            '<p class="tabs-hint">Could not render pages with pdf.js. Trying built-in viewer…</p>';
        }
      }
    }

    // Fallback: native iframe (URL or blob from typed data)
    let iframeSrc = null;
    if (resolved && resolved.kind === 'url') {
      iframeSrc = resolved.value;
    } else if (resolved && resolved.kind === 'data') {
      try {
        if (pdfObjectUrl) {
          try {
            URL.revokeObjectURL(pdfObjectUrl);
          } catch {
            /* ignore */
          }
        }
        const blob = new Blob([resolved.value], { type: 'application/pdf' });
        pdfObjectUrl = URL.createObjectURL(blob);
        iframeSrc = pdfObjectUrl;
      } catch (e) {
        console.error(e);
      }
    }
    if (pdfPages) pdfPages.innerHTML = '';
    if (pdfFrame && iframeSrc) {
      pdfFrame.classList.remove('hidden');
      pdfFrame.src = iframeSrc;
    }
  }

  if (pdfPrev) {
    pdfPrev.addEventListener('click', () => {
      if (!pdfDoc) return;
      pdfPageNum = Math.max(1, pdfPageNum - 1);
      scrollToPdfPage(pdfPageNum);
      updatePdfPageLabel();
    });
  }
  if (pdfNext) {
    pdfNext.addEventListener('click', () => {
      if (!pdfDoc) return;
      pdfPageNum = Math.min(pdfDoc.numPages, pdfPageNum + 1);
      scrollToPdfPage(pdfPageNum);
      updatePdfPageLabel();
    });
  }
  if (pdfZoomIn) {
    pdfZoomIn.addEventListener('click', async () => {
      pdfScale = Math.min(3, Math.round((pdfScale + 0.2) * 10) / 10);
      await renderAllPdfPages();
    });
  }
  if (pdfZoomOut) {
    pdfZoomOut.addEventListener('click', async () => {
      pdfScale = Math.max(0.5, Math.round((pdfScale - 0.2) * 10) / 10);
      await renderAllPdfPages();
    });
  }

  function loadOpened(doc) {
    docId = null;
    filePath = doc.path || null;
    activeFilePath = doc.path || null;
    docTitle.textContent = doc.title || 'Untitled document';
    setTitle(doc.title);
    dirty = false;

    // PDF: embed real PDF viewer (never dump binary streams into the editor)
    const helpers = window.CognitionPdf;
    const isPdf = helpers
      ? helpers.isPdfDoc(doc)
      : doc.format === 'pdf' || doc.binary || (doc.ext || '').toLowerCase() === 'pdf';

    if (isPdf) {
      clearPdfView();
      const source = helpers
        ? helpers.resolvePdfSource(doc)
        : doc.view_url
          ? { kind: 'url', value: doc.view_url }
          : doc.path
            ? { kind: 'url', value: '/api/files/raw?path=' + encodeURIComponent(doc.path) }
            : null;

      if (source) {
        // Keep a blob URL only when falling back to iframe from data bytes
        showPdfView(source);
        setStatus('Opened PDF · ' + (doc.name || doc.ext || 'pdf'));
        refreshFileList();
        return;
      }
      setStatus('Could not open PDF (no streamable source)', 'error');
      refreshFileList();
      return;
    }

    clearPdfView();
    editor.innerHTML = doc.html || '<p></p>';
    if (doc.format === 'markdown' && doc.markdown != null) {
      setMarkdownMode(true, doc.markdown);
    } else {
      setMarkdownMode(false);
    }
    setStatus('Opened · ' + (doc.ext || 'file'));
    refreshFileList();
    applyMargins();
    applyLineSpacing(currentSpacing);
    editor.focus();
  }

  async function openLocalPdfFile(file) {
    // Prefer raw bytes (ArrayBuffer) — never round-trip multi-MB PDFs as base64 JSON.
    const buf = await file.arrayBuffer();
    const data = new Uint8Array(buf);
    const baseMeta = {
      title: file.name.replace(/\.[^.]+$/, ''),
      path: file.name,
      name: file.name,
      ext: 'pdf',
      html: '',
      format: 'pdf',
      binary: true,
      mime: 'application/pdf',
    };

    try {
      setStatus('Opening ' + file.name + '…', 'saving');
      const fd = new FormData();
      fd.append('file', file, file.name);
      const doc = await api('/files/import', { method: 'POST', body: fd });
      // Server should return view_url after writing to Documents (no base64).
      if (doc && doc.view_url) {
        loadOpened(doc);
        return;
      }
      // If server still returned base64, ignore it and use local bytes.
      loadOpened(Object.assign({}, baseMeta, doc || {}, {
        binary_data: data,
        binary_base64: undefined,
        format: 'pdf',
        binary: true,
      }));
    } catch {
      loadOpened(Object.assign({}, baseMeta, { binary_data: data }));
    }
  }

  async function importLocalFiles(fileList) {
    const helpers = window.CognitionPdf;
    for (const file of fileList) {
      const isPdf = helpers
        ? helpers.isPdfFileName(file.name, file.type)
        : /\.pdf$/i.test(file.name) || file.type === 'application/pdf';

      if (isPdf) {
        await openLocalPdfFile(file);
        continue;
      }

      const fd = new FormData();
      fd.append('file', file, file.name);
      try {
        setStatus('Opening ' + file.name + '…', 'saving');
        const doc = await api('/files/import', { method: 'POST', body: fd });
        loadOpened(doc);
      } catch (e) {
        // Fallback: client-side for images / plain text
        if (file.type.startsWith('image/')) {
          insertImageFile(file);
          continue;
        }
        if (file.name.match(/\.(txt|md|markdown|html?)$/i)) {
          const text = await file.text();
          if (/\.md|markdown/i.test(file.name)) {
            loadOpened({
              title: file.name.replace(/\.[^.]+$/, ''),
              path: file.name,
              ext: 'md',
              html: clientMarkdownToHtml(text),
              markdown: text,
              format: 'markdown',
            });
          } else {
            loadOpened({
              title: file.name.replace(/\.[^.]+$/, ''),
              path: file.name,
              ext: 'txt',
              html: text
                .split(/\n\n+/)
                .map((p) => '<p>' + p.replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</p>')
                .join(''),
              format: 'text',
            });
          }
        } else {
          setStatus(e.message || 'Import failed', 'error');
        }
      }
    }
  }

  function insertImageFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      editor.focus();
      const img = document.createElement('img');
      img.src = reader.result;
      img.alt = file.name;
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.collapse(false);
        range.insertNode(img);
        range.setStartAfter(img);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        editor.appendChild(img);
      }
      markDirty();
    };
    reader.readAsDataURL(file);
  }

  async function saveDocument({ quiet = false } = {}) {
    if (mdRawMode) {
      mdSource = mdRaw.value;
      editor.innerHTML = clientMarkdownToHtml(mdSource);
    }
    const payload = {
      title: (docTitle.textContent || '').trim() || 'Untitled document',
      html: editor.innerHTML,
      starred,
    };
    if (!quiet) setStatus('Saving…', 'saving');
    try {
      let doc;
      if (docId) {
        doc = await api('/documents/' + encodeURIComponent(docId), {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        doc = await api('/documents', { method: 'POST', body: JSON.stringify(payload) });
        docId = doc.id;
      }
      dirty = false;
      setStatus('Saved locally');
      setTitle(doc.title);
      return doc;
    } catch (e) {
      setStatus('Save failed', 'error');
      throw e;
    }
  }

  async function newDocument() {
    if (dirty) {
      try {
        await saveDocument({ quiet: true });
      } catch {
        /* continue */
      }
    }
    docId = null;
    filePath = null;
    activeFilePath = null;
    docTitle.textContent = 'Untitled document';
    setTitle('Untitled document');
    clearPdfView();
    editor.innerHTML = '';
    setMarkdownMode(false);
    starred = false;
    starBtn.setAttribute('aria-pressed', 'false');
    dirty = false;
    setStatus('New document');
    applyMargins();
    applyLineSpacing(currentSpacing);
    placeCaretAtEnd(editor);
    refreshFileList();
  }

  // ── Link dialog ────────────────────────────────────────
  function openLinkDialog() {
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString() : '';
    linkText.value = text;
    linkUrl.value = '';
    linkDialog.classList.remove('hidden');
    linkUrl.focus();
  }

  function closeLinkDialog() {
    linkDialog.classList.add('hidden');
  }

  function applyLink() {
    const url = (linkUrl.value || '').trim();
    const text = (linkText.value || '').trim() || url;
    if (!url) {
      closeLinkDialog();
      return;
    }
    editor.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = text;
      if (!range.collapsed) range.deleteContents();
      range.insertNode(a);
      range.setStartAfter(a);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      exec('createLink', url);
    }
    markDirty();
    closeLinkDialog();
  }

  // ── Margins / ruler ───────────────────────────────────
  function buildRuler() {
    const ticks = document.getElementById('ruler-ticks');
    const nums = document.getElementById('ruler-numbers');
    if (!ticks || !nums) return;
    ticks.innerHTML = '';
    nums.innerHTML = '';
    for (let i = 0; i < 70; i++) {
      const t = document.createElement('i');
      ticks.appendChild(t);
    }
    for (let n = 1; n <= 7; n++) {
      const s = document.createElement('span');
      s.textContent = String(n);
      nums.appendChild(s);
    }
  }

  function bindMarginDrag(handle, side) {
    let dragging = false;
    handle.addEventListener('pointerdown', (e) => {
      dragging = true;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const track = document.getElementById('ruler-track');
      const rect = track.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const w = rect.width;
      const px = Math.max(24, Math.min(w * 0.4, x));
      if (side === 'left') {
        marginL = Math.round(px);
        if (marginL + marginR > w - 40) marginL = w - 40 - marginR;
      } else {
        const fromRight = Math.max(24, Math.min(w * 0.4, w - x));
        marginR = Math.round(fromRight);
        if (marginL + marginR > w - 40) marginR = w - 40 - marginL;
      }
      applyMargins();
      markDirty();
    });
    handle.addEventListener('pointerup', () => {
      dragging = false;
    });
  }

  // ── Wire UI ────────────────────────────────────────────
  buildPalette(textColors, TEXT_PALETTE, (c) => {
    setActiveColor(c);
    exec('foreColor', c);
    wrapSelection({ color: c });
    closeMenus();
  }, currentColor);

  buildPalette(hlColors, HL_PALETTE, (c) => {
    applyHighlight(c);
    closeMenus();
  }, currentHighlight);

  fmtBtns.forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => exec(btn.dataset.cmd));
  });

  alignBtns.forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      const map = {
        left: 'justifyLeft',
        center: 'justifyCenter',
        right: 'justifyRight',
        justify: 'justifyFull',
      };
      exec(map[btn.dataset.align]);
      editor.style.textAlign = btn.dataset.align;
    });
  });

  colorBtn.addEventListener('mousedown', (e) => e.preventDefault());
  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = picker.classList.contains('hidden');
    closeMenus();
    if (open) {
      picker.classList.remove('hidden');
      colorBtn.setAttribute('aria-expanded', 'true');
    }
  });

  highlightBtn.addEventListener('mousedown', (e) => e.preventDefault());
  highlightBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = hlPicker.classList.contains('hidden');
    closeMenus();
    if (open) {
      hlPicker.classList.remove('hidden');
      highlightBtn.setAttribute('aria-expanded', 'true');
    }
  });
  hlNone.addEventListener('mousedown', (e) => e.preventDefault());
  hlNone.addEventListener('click', () => {
    applyHighlight('transparent');
    closeMenus();
  });

  function positionMenu(menu, anchor) {
    const area = document.querySelector('.toolbar-area');
    if (!area || !menu || !anchor) return;
    const btn = anchor.getBoundingClientRect();
    const box = area.getBoundingClientRect();
    menu.style.top = btn.bottom - box.top + 8 + 'px';
    menu.style.left = Math.max(8, btn.left - box.left) + 'px';
  }

  fontBtn.addEventListener('mousedown', (e) => e.preventDefault());
  fontBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = fontMenu.classList.contains('hidden');
    closeMenus();
    if (open) {
      positionMenu(fontMenu, fontBtn);
      fontMenu.classList.remove('hidden');
      fontBtn.setAttribute('aria-expanded', 'true');
    }
  });
  fontMenu.querySelectorAll('.font-option').forEach((opt) => {
    opt.addEventListener('mousedown', (e) => e.preventDefault());
    opt.addEventListener('click', () => {
      applyFont(opt.dataset.font);
      closeMenus();
    });
  });

  styleBtn.addEventListener('mousedown', (e) => e.preventDefault());
  styleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = styleMenu.classList.contains('hidden');
    closeMenus();
    if (open) {
      positionMenu(styleMenu, styleBtn);
      styleMenu.classList.remove('hidden');
      styleBtn.setAttribute('aria-expanded', 'true');
    }
  });
  styleMenu.querySelectorAll('[data-style]').forEach((opt) => {
    opt.addEventListener('mousedown', (e) => e.preventDefault());
    opt.addEventListener('click', () => applyStyle(opt.dataset.style));
  });

  spacingBtn.addEventListener('mousedown', (e) => e.preventDefault());
  spacingBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = spacingMenu.classList.contains('hidden');
    closeMenus();
    if (open) {
      positionMenu(spacingMenu, spacingBtn);
      spacingMenu.classList.remove('hidden');
      spacingBtn.setAttribute('aria-expanded', 'true');
    }
  });
  spacingMenu.querySelectorAll('[data-spacing]').forEach((opt) => {
    opt.addEventListener('mousedown', (e) => e.preventDefault());
    opt.addEventListener('click', () => {
      applyLineSpacing(opt.dataset.spacing);
      closeMenus();
    });
  });

  document.addEventListener('click', (e) => {
    if (
      !e.target.closest('#picker') &&
      !e.target.closest('#hl-picker') &&
      !e.target.closest('#font-menu') &&
      !e.target.closest('#style-menu') &&
      !e.target.closest('#spacing-menu') &&
      !e.target.closest('#insert-menu') &&
      !e.target.closest('#insert-btn') &&
      !e.target.closest('#color-btn') &&
      !e.target.closest('#highlight-btn') &&
      !e.target.closest('#font-btn') &&
      !e.target.closest('#style-btn') &&
      !e.target.closest('#spacing-btn')
    ) {
      closeMenus();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMenus();
      closeLinkDialog();
      chartDialog.classList.add('hidden');
      drawDialog.classList.add('hidden');
    }
  });

  // Insert menu under PlusSquare in the options bar
  insertBtn.addEventListener('mousedown', (e) => e.preventDefault());
  insertBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = insertMenu.classList.contains('hidden');
    closeMenus();
    if (open) {
      positionMenu(insertMenu, insertBtn);
      insertMenu.classList.remove('hidden');
      insertBtn.setAttribute('aria-expanded', 'true');
    }
  });
  insertMenu.querySelectorAll('[data-insert]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.insert;
      closeMenus();
      if (kind === 'pie' || kind === 'bar' || kind === 'line') openChartDialog(kind);
      else if (kind === 'sheet') insertSheet();
      else if (kind === 'drawing') {
        initDraw();
        drawDialog.classList.remove('hidden');
      } else if (kind === 'divider') insertDivider();
    });
  });
  chartApply.addEventListener('click', applyChart);
  chartDialog.querySelectorAll('[data-close="chart"]').forEach((el) => {
    el.addEventListener('click', () => chartDialog.classList.add('hidden'));
  });
  drawDialog.querySelectorAll('[data-close="draw"]').forEach((el) => {
    el.addEventListener('click', () => drawDialog.classList.add('hidden'));
  });

  // Export chips
  document.querySelectorAll('[data-export]').forEach((btn) => {
    btn.addEventListener('click', () => exportAs(btn.dataset.export));
  });

  // Font size: arrows ±2, input editable
  fsMinus.addEventListener('mousedown', (e) => e.preventDefault());
  fsPlus.addEventListener('mousedown', (e) => e.preventDefault());
  fsMinus.addEventListener('click', () => {
    applyFontSize(currentPt - 2);
    editor.focus();
  });
  fsPlus.addEventListener('click', () => {
    applyFontSize(currentPt + 2);
    editor.focus();
  });
  fsVal.addEventListener('focus', () => fsVal.select());
  fsVal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyFontSize(fsVal.value);
      editor.focus();
    }
  });
  fsVal.addEventListener('blur', () => applyFontSize(fsVal.value));
  fsVal.addEventListener('mousedown', (e) => e.stopPropagation());

  undoBtn.addEventListener('mousedown', (e) => e.preventDefault());
  redoBtn.addEventListener('mousedown', (e) => e.preventDefault());
  undoBtn.addEventListener('click', () => exec('undo'));
  redoBtn.addEventListener('click', () => exec('redo'));
  printBtn.addEventListener('click', () => window.print());

  document.getElementById('ul-btn').addEventListener('click', () => exec('insertUnorderedList'));
  document.getElementById('ol-btn').addEventListener('click', () => exec('insertOrderedList'));
  document.getElementById('indent-btn').addEventListener('click', () => exec('indent'));
  document.getElementById('outdent-btn').addEventListener('click', () => exec('outdent'));
  document.getElementById('clear-fmt-btn').addEventListener('click', () => exec('removeFormat'));

  linkBtn.addEventListener('click', openLinkDialog);
  linkApply.addEventListener('click', applyLink);
  linkDialog.querySelectorAll('[data-close="link"]').forEach((el) => {
    el.addEventListener('click', closeLinkDialog);
  });

  imageBtn.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', () => {
    const files = imageInput.files;
    if (!files || !files.length) return;
    Array.from(files).forEach(insertImageFile);
    imageInput.value = '';
  });

  sidebarOpen.addEventListener('click', () => fileOpenInput.click());
  fileOpenInput.addEventListener('change', () => {
    if (fileOpenInput.files && fileOpenInput.files.length) {
      importLocalFiles(Array.from(fileOpenInput.files));
    }
    fileOpenInput.value = '';
  });

  floatTb.querySelectorAll('[data-ft]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      if (btn.dataset.ft === 'highlight') applyHighlight(currentHighlight);
      else exec(btn.dataset.ft);
    });
  });

  starBtn.addEventListener('click', async () => {
    starred = starBtn.getAttribute('aria-pressed') !== 'true';
    starBtn.setAttribute('aria-pressed', starred ? 'true' : 'false');
    markDirty();
    try {
      await saveDocument({ quiet: true });
    } catch {
      /* ignore */
    }
  });

  saveBtn.addEventListener('click', () => saveDocument());
  sidebarNew.addEventListener('click', () => newDocument());
  mdToggle.addEventListener('click', toggleMarkdownView);
  mdRaw.addEventListener('input', () => {
    mdSource = mdRaw.value;
    markDirty();
  });

  /** Auto-start lists when the line begins with "- " or "1. " (space triggers). */
  function tryAutoListOnSpace(e) {
    if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
    if (!editor.contains(sel.anchorNode)) return false;

    // Already inside a list — don't re-trigger
    let node = sel.anchorNode;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (node && node.closest && node.closest('li')) return false;

    const range = sel.getRangeAt(0);
    // Text from start of current block to caret
    const block = closestBlock(range.startContainer);
    if (!block || !editor.contains(block)) return false;

    const preRange = document.createRange();
    preRange.setStart(block, 0);
    preRange.setEnd(range.startContainer, range.startOffset);
    const prefix = preRange.toString().replace(/\u200B/g, '');
    // Only at start of line/block: marker must be the sole non-whitespace content before caret
    let listCmd = null;
    if (/^\s*-$/.test(prefix)) {
      listCmd = 'insertUnorderedList';
    } else if (/^\s*\d+\.$/.test(prefix)) {
      listCmd = 'insertOrderedList';
    }
    if (!listCmd) return false;

    e.preventDefault();
    // Delete the marker (- or 1.) from the block start up to caret
    const del = document.createRange();
    del.setStart(block, 0);
    del.setEnd(range.startContainer, range.startOffset);
    // Prefer deleting only the marker chars if block has other content after caret — caret is at end of marker
    del.deleteContents();
    // Collapse leftover empty text / zwsp
    if (block.textContent.replace(/\u200B/g, '').trim() === '') {
      block.innerHTML = '<br>';
    }
    // Place caret in the cleaned block
    const caret = document.createRange();
    caret.selectNodeContents(block);
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);
    document.execCommand(listCmd, false, null);
    markDirty();
    sync();
    return true;
  }

  function closestBlock(node) {
    let n = node;
    if (n.nodeType === Node.TEXT_NODE) n = n.parentElement;
    while (n && n !== editor) {
      const tag = (n.tagName || '').toLowerCase();
      if (
        tag === 'p' ||
        tag === 'div' ||
        tag === 'h1' ||
        tag === 'h2' ||
        tag === 'h3' ||
        tag === 'h4' ||
        tag === 'h5' ||
        tag === 'h6' ||
        tag === 'li' ||
        tag === 'blockquote'
      ) {
        return n;
      }
      n = n.parentElement;
    }
    // contenteditable root acting as the block
    return editor;
  }

  editor.addEventListener('keydown', (e) => {
    if (tryAutoListOnSpace(e)) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') {
        e.preventDefault();
        exec('bold');
      } else if (k === 'i') {
        e.preventDefault();
        exec('italic');
      } else if (k === 'u') {
        e.preventDefault();
        exec('underline');
      } else if (k === 's') {
        e.preventDefault();
        saveDocument();
      } else if (k === 'p') {
        e.preventDefault();
        window.print();
      } else if (k === 'z') {
        e.preventDefault();
        exec('undo');
      } else if (k === 'y') {
        e.preventDefault();
        exec('redo');
      } else if (k === 'k') {
        e.preventDefault();
        openLinkDialog();
      } else if (k === 'o') {
        e.preventDefault();
        fileOpenInput.click();
      }
    }
  });

  ['keyup', 'mouseup', 'focus', 'input'].forEach((ev) => {
    editor.addEventListener(ev, () => {
      if (ev === 'input') {
        markDirty();
        loupeCloneDirty = true;
      }
      sync();
    });
  });
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === editor || editor.contains(document.activeElement)) sync();
  });

  // Text loupe: glass magnifier while dragging to select (WWDC liquid lens)
  editor.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !loupeAllowed()) return;
    loupeDragging = true;
    loupeActive = false;
    loupeCloneDirty = true;
    loupeOriginX = e.clientX;
    loupeOriginY = e.clientY;
    loupeLastX = e.clientX;
    loupeLastY = e.clientY;
  });
  window.addEventListener(
    'pointermove',
    (e) => {
      if (!loupeDragging) return;
      scheduleLoupe(e.clientX, e.clientY);
    },
    { passive: true }
  );
  function endLoupe() {
    loupeDragging = false;
    loupeActive = false;
    hideLoupe();
  }
  window.addEventListener('pointerup', endLoupe);
  window.addEventListener('pointercancel', endLoupe);
  editor.addEventListener('blur', endLoupe);

  document.querySelectorAll('.t-icon, .t-btn, .t-drop').forEach((el) => {
    el.addEventListener('mousedown', (e) => {
      if (el.closest('#toolbar') && el.id !== 'fs-val') e.preventDefault();
    });
  });

  editor.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (items) {
      for (const it of items) {
        if (it.type.startsWith('image/')) {
          e.preventDefault();
          const f = it.getAsFile();
          if (f) insertImageFile(f);
          return;
        }
      }
    }
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
    markDirty();
  });

  paper.addEventListener('mousedown', (e) => {
    if (e.target.id === 'paper') {
      e.preventDefault();
      placeCaretAtEnd(editor);
    }
  });

  docTitle.addEventListener('input', () => {
    setTitle(docTitle.textContent);
    markDirty();
  });
  docTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      docTitle.blur();
      editor.focus();
    }
  });
  docTitle.addEventListener('blur', () => {
    if (!docTitle.textContent.trim()) docTitle.textContent = 'Untitled document';
    setTitle(docTitle.textContent);
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Drag-drop files onto app
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      importLocalFiles(Array.from(e.dataTransfer.files));
    }
  });

  // Theme (dark / light)
  const themeToggle = document.getElementById('theme-toggle');
  const metaTheme = document.getElementById('meta-theme-color');

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    const t = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    try {
      localStorage.setItem('cognition-theme', t);
    } catch {
      /* ignore */
    }
    if (metaTheme) metaTheme.setAttribute('content', t === 'dark' ? '#000000' : '#ffffff');
    if (themeToggle) {
      themeToggle.title = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      themeToggle.setAttribute('aria-label', themeToggle.title);
    }
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    });
  }

  // Keep in sync if OS preference changes and user has not forced a choice
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', (e) => {
      if (!localStorage.getItem('cognition-theme')) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  } catch {
    /* ignore */
  }
  applyTheme(currentTheme());

  // Init
  setActiveColor('#000000');
  setActiveHighlight('#ffff00');
  fontLabel.textContent = currentFont;
  fsVal.value = '12';
  buildRuler();
  bindMarginDrag(marginLeft, 'left');
  bindMarginDrag(marginRight, 'right');
  applyMargins();
  applyLineSpacing(1.5);
  setMarkdownMode(false);
  initDraw();

  (async function bootstrap() {
    try {
      const health = await api('/health');
      if (health.documents_dir) {
        docsFolderLabel.textContent = 'Documents';
        docsFolderLabel.title = health.documents_dir;
      }
      await refreshFileList();
      placeCaretAtEnd(editor);
    } catch (e) {
      setStatus('Offline UI mode', 'error');
      placeCaretAtEnd(editor);
    }
  })();

  if (window.CognitionLiquidGlass && typeof window.CognitionLiquidGlass.attach === 'function') {
    window.CognitionLiquidGlass.attach({
      scrollEl: document.getElementById('center'),
      getSurfaces: () => window.CognitionLiquidGlass.querySurfaces(document),
    });
  }
})();
