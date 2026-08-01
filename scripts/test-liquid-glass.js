#!/usr/bin/env node
/**
 * Real tests for shipped Liquid Glass material math + structure.
 * Exercises static/liquid-glass.js (the browser entry) — no stubs.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const lgPath = path.join(root, 'static', 'liquid-glass.js');
const cssPath = path.join(root, 'static', 'style.css');
const htmlPath = path.join(root, 'static', 'index.html');
const scriptPath = path.join(root, 'static', 'script.js');

let failed = 0;
let passed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  PASS  ' + msg);
  } else {
    failed++;
    console.error('  FAIL  ' + msg);
  }
}

function assertClose(actual, expected, eps, msg) {
  const ok = Math.abs(actual - expected) <= eps;
  assert(ok, `${msg} (got ${actual}, expected ~${expected})`);
}

console.log('=== Liquid Glass unit tests ===\n');

// ── 1. Load shipped module ───────────────────────────────
console.log('1. Load shipped static/liquid-glass.js');
assert(fs.existsSync(lgPath), 'static/liquid-glass.js exists');
const LG = require(lgPath);
assert(typeof LG.specularFromPointer === 'function', 'exports specularFromPointer');
assert(typeof LG.specularFromScroll === 'function', 'exports specularFromScroll');
assert(typeof LG.blendSpecular === 'function', 'exports blendSpecular');
assert(typeof LG.applySpecularVars === 'function', 'exports applySpecularVars');
assert(typeof LG.updateSurfaces === 'function', 'exports updateSurfaces');

// ── 2. Pure specular math ────────────────────────────────
console.log('\n2. specularFromPointer geometry');
const rect = { left: 100, top: 50, width: 200, height: 100 };

const center = LG.specularFromPointer(200, 100, rect);
assertClose(center.nx, 0.5, 1e-9, 'center nx ≈ 0.5');
assertClose(center.ny, 0.5, 1e-9, 'center ny ≈ 0.5');
assertClose(center.x, 50, 0.05, 'center specular x ≈ 50%');
assert(center.y > 0 && center.y < 100, 'center specular y in range');
assertClose(center.rx, 0, 0.05, 'center refract rx ≈ 0');

const tl = LG.specularFromPointer(100, 50, rect);
assertClose(tl.nx, 0, 1e-9, 'top-left nx = 0');
assertClose(tl.ny, 0, 1e-9, 'top-left ny = 0');
assertClose(tl.x, 0, 0.05, 'top-left specular x = 0');
assert(tl.rx < 0, 'top-left refract pulls left');

const br = LG.specularFromPointer(300, 150, rect);
assertClose(br.nx, 1, 1e-9, 'bottom-right nx = 1');
assertClose(br.ny, 1, 1e-9, 'bottom-right ny = 1');
assertClose(br.x, 100, 0.05, 'bottom-right specular x = 100');
assert(br.rx > 0, 'bottom-right refract pulls right');

// Outside rect clamps
const outside = LG.specularFromPointer(0, 0, rect);
assertClose(outside.nx, 0, 1e-9, 'outside clamps nx to 0');
assertClose(outside.ny, 0, 1e-9, 'outside clamps ny to 0');

// maxRefract option is honored
const wide = LG.specularFromPointer(300, 100, rect, { maxRefract: 10 });
assertClose(wide.rx, 10, 0.05, 'maxRefract=10 at right edge');

// ── 3. Scroll specular ───────────────────────────────────
console.log('\n3. specularFromScroll');
const s0 = LG.specularFromScroll(0, 1000);
const s1 = LG.specularFromScroll(1000, 1000);
assert(s1.y > s0.y, 'scroll increases specular y');
assert(s1.ry >= s0.ry, 'scroll increases refract y');
const sEmpty = LG.specularFromScroll(50, 0);
assertClose(sEmpty.x, 48, 0.1, 'zero maxScroll uses t=0');

// ── 4. Blend ─────────────────────────────────────────────
console.log('\n4. blendSpecular');
const blended = LG.blendSpecular(
  { x: 100, y: 100, rx: 10, ry: 10 },
  { x: 0, y: 0, rx: 0, ry: 0 },
  0.8
);
assertClose(blended.x, 80, 0.05, 'blend x with weight 0.8');
assertClose(blended.y, 80, 0.05, 'blend y with weight 0.8');
const onlyScroll = LG.blendSpecular(null, { x: 40, y: 20, rx: 1, ry: 2 });
assertClose(onlyScroll.x, 40, 0.05, 'null pointer uses scroll');
const defaults = LG.blendSpecular(null, null);
assertClose(defaults.x, 50, 0.05, 'null+null default x');

// ── 5. applySpecularVars on mock element ─────────────────
console.log('\n5. applySpecularVars writes CSS custom properties');
const props = {};
const mockEl = {
  style: {
    setProperty(k, v) {
      props[k] = v;
    },
  },
};
const ok = LG.applySpecularVars(mockEl, { x: 33.3, y: 22.2, rx: 1.5, ry: -2 });
assert(ok === true, 'applySpecularVars returns true');
assert(props['--specular-x'] === '33.3%', 'sets --specular-x');
assert(props['--specular-y'] === '22.2%', 'sets --specular-y');
assert(props['--refract-x'] === '1.5px', 'sets --refract-x');
assert(props['--refract-y'] === '-2px', 'sets --refract-y');
assert(LG.applySpecularVars(null, { x: 1, y: 1, rx: 0, ry: 0 }) === false, 'null el returns false');

// ── 6. updateSurfaces drives mock surfaces ───────────────
console.log('\n6. updateSurfaces');
const props2 = {};
const surface = {
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50 };
  },
  style: {
    setProperty(k, v) {
      props2[k] = v;
    },
  },
};
const n = LG.updateSurfaces([surface], 50, 25, { scrollTop: 0, maxScroll: 0 });
assert(n === 1, 'updateSurfaces updates 1 surface');
assert(typeof props2['--specular-x'] === 'string', 'surface received --specular-x');
assert(props2['--specular-x'].endsWith('%'), 'specular x is percent');
assert(props2['--refract-x'].endsWith('px'), 'refract x is px');

// ── 7. Shipped CSS structure ─────────────────────────────
console.log('\n7. CSS multi-layer material structure');
const css = fs.readFileSync(cssPath, 'utf8');
assert(css.includes('--specular-x'), 'CSS defines --specular-x');
assert(css.includes('--specular-y'), 'CSS defines --specular-y');
assert(css.includes('--refract-x'), 'CSS defines --refract-x');
assert(css.includes('--refract-y'), 'CSS defines --refract-y');
assert(css.includes('--lg-fill-heavy'), 'CSS density token --lg-fill-heavy');
assert(css.includes('--lg-blur-heavy'), 'CSS density token --lg-blur-heavy');
assert(/backdrop-filter:\s*[\s\S]*blur\(var\(--lg-blur\)\)/.test(css), 'backdrop blur uses --lg-blur');
assert(css.includes('url(#lg-refract)'), 'CSS references SVG refraction filter');
assert(css.includes('mix-blend-mode: soft-light'), 'specular uses soft-light blend');
assert(
  css.includes('.liquid-glass::before') || css.includes('.glass::before'),
  'rim/highlight ::before layer'
);
assert(
  css.includes('.liquid-glass::after') || css.includes('.glass::after'),
  'dynamic specular ::after layer'
);
assert(css.includes('prefers-reduced-transparency'), 'reduced-transparency fallback');
assert(css.includes('prefers-reduced-motion'), 'reduced-motion fallback');
assert(css.includes('#text-loupe'), 'CSS defines text loupe');
assert(css.includes('border-radius: 999px') || css.includes('border-radius:999px'), 'capsule radii present');

// Paper must not be glass
const paperBlock = css.match(/#paper[\s\S]{0,800}/);
assert(paperBlock, '#paper rule exists');
assert(
  /backdrop-filter:\s*none\s*!important/.test(paperBlock[0]) ||
    css.includes('#paper,\n.paper-surface') ||
    css.includes('#paper,\r\n.paper-surface') ||
    css.includes('paper-surface'),
  'paper surface is solid (no liquid glass)'
);
assert(
  !/#paper[^{]*\{[^}]*backdrop-filter:\s*blur/.test(css),
  '#paper does not use backdrop blur as glass'
);

// ── 8. HTML chrome markers ───────────────────────────────
console.log('\n8. HTML chrome / content hierarchy');
const html = fs.readFileSync(htmlPath, 'utf8');
assert(html.includes('id="lg-refract"'), 'SVG filter #lg-refract defined');
assert(html.includes('liquid-glass'), 'liquid-glass class on chrome');
assert(html.includes('liquid-glass--heavy'), 'heavy density on chrome');
assert(html.includes('id="header"') && /header[^>]*liquid-glass|header[^>]*glass/.test(html), 'header is glass');
assert(html.includes('id="toolbar"') && html.includes('liquid-glass'), 'toolbar is glass');
assert(html.includes('id="left"') && html.includes('liquid-glass--medium'), 'sidebar is glass');
assert(html.includes('floating-glass'), 'floating toolbar is glass');
assert(html.includes('glass-menu'), 'menus use glass-menu');
assert(html.includes('id="text-loupe"'), 'text loupe element present');
assert(html.includes('id="text-loupe-content"'), 'text loupe content layer present');
assert(html.includes('paper-surface') || /id="paper"[^>]*class="[^"]*paper/.test(html), 'paper is solid surface');
assert(!/id="paper"[^>]*class="[^"]*liquid-glass/.test(html), 'paper is not liquid-glass');
assert(!/id="editor"[^>]*class="[^"]*liquid-glass/.test(html), 'editor is not liquid-glass');
assert(html.includes('liquid-glass.js'), 'loads liquid-glass.js');

// ── 9. script.js wires driver ────────────────────────────
console.log('\n9. Frontend wires CognitionLiquidGlass.attach');
const script = fs.readFileSync(scriptPath, 'utf8');
assert(script.includes('CognitionLiquidGlass'), 'script references CognitionLiquidGlass');
assert(script.includes('.attach('), 'script calls attach()');
assert(script.includes('text-loupe') || script.includes('textLoupe'), 'script wires text loupe');
assert(script.includes('loupeContentOffset') || script.includes('LOUPE_SCALE'), 'script positions loupe content');

// ── 9b. Loupe + floating toolbar layout math ─────────────
console.log('\n9b. Loupe / floating toolbar layout helpers');
assert(typeof LG.loupeContentOffset === 'function', 'exports loupeContentOffset');
assert(typeof LG.floatingToolbarLayout === 'function', 'exports floatingToolbarLayout');
const lo = LG.loupeContentOffset(40, 30, 120, 2);
assertClose(lo.tx, 60 - 80, 0.05, 'loupe tx centers focusX under scale');
assertClose(lo.ty, 60 - 60, 0.05, 'loupe ty centers focusY under scale');
assertClose(lo.scale, 2, 0.001, 'loupe scale preserved');
const ft = LG.floatingToolbarLayout(
  { left: 200, top: 300, width: 100, height: 20, bottom: 320 },
  { left: 0, top: 0, width: 800, height: 1000 },
  { barHeight: 44, gap: 8, pad: 8, halfWidth: 90 }
);
assert(ft.top < 300, 'toolbar sits above selection when room allows');
assert(ft.left > 90 && ft.left < 800 - 90, 'toolbar left clamped in host');
const ftLow = LG.floatingToolbarLayout(
  { left: 100, top: 10, width: 80, height: 16, bottom: 26 },
  { left: 0, top: 0, width: 400, height: 200 },
  { barHeight: 44, gap: 8, pad: 8, halfWidth: 60 }
);
assert(ftLow.top >= 8, 'toolbar flips below when no room above');

// ── 10. Overflow must not clip chrome popovers ───────────
console.log('\n10. Overflow rules for menus / pickers (skeptic-fixed)');
// Extract base liquid-glass rule body (first occurrence of .liquid-glass, .glass { ... })
const baseGlassMatch = css.match(
  /\.liquid-glass,\s*\.glass\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/
) || css.match(/\.liquid-glass,\s*\.glass\s*\{([^}]+)\}/);
assert(!!baseGlassMatch, 'found base .liquid-glass/.glass rule');
const baseBody = baseGlassMatch ? baseGlassMatch[1] : '';
assert(
  /overflow\s*:\s*visible/.test(baseBody),
  'base liquid-glass uses overflow:visible (not hidden)'
);
assert(
  !/overflow\s*:\s*hidden/.test(baseBody),
  'base liquid-glass does not set overflow:hidden'
);

// toolbar-pill must not force non-visible overflow that collapses y→auto
const pillMatch = css.match(/\.toolbar-pill\s*\{([^}]+)\}/);
assert(!!pillMatch, 'found .toolbar-pill rule');
const pillDecls = pillMatch[1]
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);
assert(
  pillDecls.some((d) => /^overflow\s*:\s*visible\s*$/.test(d)),
  'toolbar-pill overflow:visible so menus can escape'
);
assert(
  !pillDecls.some((d) => /^overflow-x\s*:\s*auto\s*$/.test(d)),
  'toolbar-pill itself is not overflow-x:auto (scroll is on .toolbar-scroll)'
);
assert(/\.toolbar-scroll\s*\{/.test(css), 'inner .toolbar-scroll scroller exists');
const scrollMatch = css.match(/\.toolbar-scroll\s*\{([^}]+)\}/);
assert(!!scrollMatch, 'found .toolbar-scroll rule');
assert(/overflow-x\s*:\s*auto/.test(scrollMatch[1]), 'toolbar-scroll has overflow-x:auto');

// glass-menu: overflow-y auto without overflow:hidden shorthand
const menuMatch = css.match(/\.glass-menu\s*\{([^}]+)\}/);
assert(!!menuMatch, 'found .glass-menu rule');
const menuDecls = menuMatch[1]
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);
assert(
  menuDecls.some((d) => /^overflow-y\s*:\s*auto\s*$/.test(d)),
  'glass-menu overflow-y:auto'
);
assert(
  !menuDecls.some((d) => /^overflow\s*:\s*hidden\s*$/.test(d)),
  'glass-menu rule has no overflow:hidden shorthand'
);

// font-menu must live outside toolbar scroller in markup
assert(
  /toolbar-scroll[\s\S]*?<\/div>\s*<\/div>\s*<div id="font-menu"/.test(html) ||
    (html.includes('toolbar-scroll') &&
      html.indexOf('id="font-menu"') > html.indexOf('toolbar-scroll') &&
      html.indexOf('id="font-menu"') > html.indexOf('</div>', html.indexOf('id="toolbar"'))),
  'font-menu is outside toolbar-scroll / not nested in scroller'
);
assert(
  script.includes('positionMenu') || script.includes('positionFontMenu'),
  'script positions portaled font menu'
);

// ── Summary ──────────────────────────────────────────────
console.log('\n=== Results ===');
console.log(`passed=${passed} failed=${failed}`);
if (failed > 0) {
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
