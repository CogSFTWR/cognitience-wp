/**
 * Manual spellcheck: underline misspelled words on demand (no live checking while typing).
 */
'use strict';

const WORD_RE = /[a-zA-Z]+(?:'[a-zA-Z]+)?/g;

function shouldSkipWord(word) {
  if (!word || word.length <= 1) return true;
  if (word === word.toUpperCase() && word.length > 1) return true;
  return false;
}

function unwrapMisspelled(root) {
  if (!root) return;
  root.querySelectorAll('.cog-misspelled').forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  });
  root.normalize();
}

function wrapMisspelledInTextNode(textNode, checker) {
  if (!textNode || !textNode.textContent || !checker) return;
  const parent = textNode.parentElement;
  if (!parent || parent.closest('.cog-misspelled')) return;

  const text = textNode.textContent;
  const fragments = [];
  let lastIndex = 0;
  let changed = false;
  let match;

  WORD_RE.lastIndex = 0;
  while ((match = WORD_RE.exec(text)) !== null) {
    const word = match[0];
    if (shouldSkipWord(word)) continue;
    if (checker.isCorrect(word.toLowerCase())) continue;

    changed = true;
    if (match.index > lastIndex) {
      fragments.push(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const span = document.createElement('span');
    span.className = 'cog-misspelled';
    span.setAttribute('spellcheck', 'false');
    span.dataset.word = word;
    span.textContent = word;
    fragments.push(span);
    lastIndex = match.index + word.length;
  }

  if (!changed) return;
  if (lastIndex < text.length) {
    fragments.push(document.createTextNode(text.slice(lastIndex)));
  }

  const ref = textNode;
  fragments.forEach((frag) => parent.insertBefore(frag, ref));
  parent.removeChild(textNode);
}

function collectTextNodes(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement && node.parentElement.closest('.cog-misspelled')) continue;
    if (node.textContent && node.textContent.trim().length > 0) nodes.push(node);
  }
  return nodes;
}

function runManualSpellcheck(editor, checker) {
  if (!editor || !checker) return { count: 0 };
  unwrapMisspelled(editor);
  const textNodes = collectTextNodes(editor);
  let count = 0;
  for (const textNode of textNodes) {
    const before = editor.querySelectorAll('.cog-misspelled').length;
    wrapMisspelledInTextNode(textNode, checker);
    count = editor.querySelectorAll('.cog-misspelled').length;
  }
  return { count: editor.querySelectorAll('.cog-misspelled').length };
}

function clearMisspelledMarks(editor) {
  unwrapMisspelled(editor);
}

if (typeof window !== 'undefined') {
  window.SpellManual = { runManualSpellcheck, clearMisspelledMarks, unwrapMisspelled };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runManualSpellcheck, clearMisspelledMarks, unwrapMisspelled };
}