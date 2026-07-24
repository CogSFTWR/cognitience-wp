#!/usr/bin/env node
/**
 * Structure report for Liquid Glass chrome (verification plan step 1).
 * Writes human-readable notes; exits non-zero if hierarchy is wrong.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'static', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'static', 'index.html'), 'utf8');

const lines = [];
function note(s) {
  lines.push(s);
}

note('Cognition WP — Liquid Glass structure audit');
note(new Date().toISOString());
note('');

const layers = [
  ['frosted fill', /--lg-fill|background:\s*var\(--lg-fill\)/],
  ['backdrop blur', /backdrop-filter:[\s\S]*blur\(var\(--lg-blur\)\)/],
  ['saturation', /saturate\(var\(--lg-sat\)\)/],
  ['specular rim ::before', /\.liquid-glass::before|\.glass::before/],
  ['dynamic specular ::after', /\.liquid-glass::after|\.glass::after/],
  ['specular CSS vars', /--specular-x/],
  ['refraction CSS vars', /--refract-x/],
  ['SVG refraction filter', /url\(#lg-refract\)/],
  ['depth shadow tokens', /--lg-shadow-heavy/],
  ['density hierarchy', /liquid-glass--heavy|glass-heavy/],
];

note('Material layers present in style.css:');
let missing = 0;
for (const [name, re] of layers) {
  const ok = re.test(css);
  note(`  [${ok ? 'x' : ' '}] ${name}`);
  if (!ok) missing++;
}

note('');
note('Chrome application (index.html):');
const chrome = [
  ['header', () => /id="header"/.test(html) && /liquid-glass/.test(html.match(/<header[\s\S]*?<\/header>/)[0])],
  ['toolbar', () => {
    const m = html.match(/<div[^>]*id="toolbar"[^>]*>|<div[^>]*class="[^"]*toolbar-pill[^"]*"[^>]*id="toolbar"[^>]*>/);
    return m && m[0].includes('liquid-glass');
  }],
  ['sidebar #left', () => {
    const m = html.match(/<aside[^>]*id="left"[^>]*>/);
    return m && m[0].includes('liquid-glass');
  }],
  ['pickers', () => /id="picker"[^>]*liquid-glass|class="[^"]*picker[^"]*liquid-glass/.test(html)],
  ['font menu', () => /id="font-menu"[^>]*glass-menu|class="[^"]*glass-menu/.test(html)],
  ['floating toolbar', () => /id="floating-toolbar"[^>]*floating-glass|floating-glass/.test(html)],
  ['SVG #lg-refract', () => /id="lg-refract"/.test(html)],
];
for (const [name, check] of chrome) {
  const ok = check();
  note(`  [${ok ? 'x' : ' '}] ${name}`);
  if (!ok) missing++;
}

note('');
note('Content hierarchy (must NOT be glass):');
const paperIsGlass = /id="paper"[^>]*liquid-glass/.test(html);
const editorIsGlass = /id="editor"[^>]*liquid-glass/.test(html);
const paperSolid = /paper-surface/.test(html) || /id="paper"/.test(html);
note(`  [${!paperIsGlass ? 'x' : ' '}] #paper not liquid-glass (isGlass=${paperIsGlass})`);
note(`  [${!editorIsGlass ? 'x' : ' '}] #editor not liquid-glass (isGlass=${editorIsGlass})`);
note(`  [${paperSolid ? 'x' : ' '}] paper surface present`);
if (paperIsGlass || editorIsGlass) missing++;

note('');
note('Accessibility fallbacks:');
note(`  [${/prefers-reduced-transparency/.test(css) ? 'x' : ' '}] reduced-transparency`);
note(`  [${/prefers-reduced-motion/.test(css) ? 'x' : ' '}] reduced-motion`);

const report = lines.join('\n') + '\n';
process.stdout.write(report);

if (missing > 0) {
  console.error(`Structure check failed: ${missing} missing items`);
  process.exit(1);
}
console.error('Structure check OK');
process.exit(0);
