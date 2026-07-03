/**
 * Pure DOM helper: find a misspelled token in a contenteditable root and replace it.
 * Used by renderer applySpellingFix and unit-tested via jsdom in logic-exercise.
 */
'use strict';

function distanceToRange(caretRange, wordRange) {
  if (caretRange.compareBoundaryPoints(Range.END_TO_START, wordRange) <= 0 &&
      caretRange.compareBoundaryPoints(Range.START_TO_END, wordRange) >= 0) {
    return 0;
  }
  const caretNode = caretRange.startContainer;
  const caretOffset = caretRange.startOffset;
  const wordStart = wordRange.startContainer;
  const wordStartOffset = wordRange.startOffset;
  const wordEnd = wordRange.endContainer;
  const wordEndOffset = wordRange.endOffset;

  if (caretNode === wordStart && caretOffset >= wordStartOffset && caretOffset <= wordEndOffset) {
    return 0;
  }
  if (caretNode === wordEnd && caretOffset >= wordStartOffset && caretOffset <= wordEndOffset) {
    return 0;
  }

  const before = document.createRange();
  before.setStart(caretNode, caretOffset);
  before.setEnd(wordStart, wordStartOffset);
  const after = document.createRange();
  after.setStart(wordEnd, wordEndOffset);
  after.setEnd(caretNode, caretOffset);
  return Math.min(before.toString().length, after.toString().length);
}

function expandTextRangeToWord(textNode, offset, misspelledWord) {
  const text = textNode.textContent || '';
  const idx = text.indexOf(misspelledWord, Math.max(0, offset - misspelledWord.length));
  if (idx === -1) return null;
  const end = idx + misspelledWord.length;
  if (offset < idx || offset > end) return null;
  const range = document.createRange();
  range.setStart(textNode, idx);
  range.setEnd(textNode, end);
  return range;
}

function findRangeAtPoint(rootEl, misspelledWord, x, y) {
  if (x == null || y == null || !rootEl) return null;

  let probe = null;
  if (typeof document.caretRangeFromPoint === 'function') {
    probe = document.caretRangeFromPoint(x, y);
  } else if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos && pos.offsetNode) {
      probe = document.createRange();
      probe.setStart(pos.offsetNode, pos.offset);
      probe.collapse(true);
    }
  }
  if (!probe || !rootEl.contains(probe.startContainer)) return null;

  const node = probe.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  return expandTextRangeToWord(node, probe.startOffset, misspelledWord);
}

function findMisspelledRange(rootEl, misspelledWord, selection, options) {
  if (!rootEl || !misspelledWord) return null;

  if (options && options.range) {
    const stored = options.range.cloneRange();
    if (stored.toString() === misspelledWord) return stored;
    if (stored.collapsed && stored.startContainer.nodeType === Node.TEXT_NODE) {
      const expanded = expandTextRangeToWord(
        stored.startContainer,
        stored.startOffset,
        misspelledWord,
      );
      if (expanded) return expanded;
    }
  }

  if (options && options.x != null && options.y != null) {
    const atPoint = findRangeAtPoint(rootEl, misspelledWord, options.x, options.y);
    if (atPoint) return atPoint;
  }

  if (!selection) return null;

  if (selection.toString() === misspelledWord && selection.rangeCount > 0) {
    return selection.getRangeAt(0).cloneRange();
  }

  const caretRange = selection.rangeCount ? selection.getRangeAt(0) : null;
  let best = null;
  let bestDist = Infinity;

  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  let textNode;
  while ((textNode = walker.nextNode())) {
    const text = textNode.textContent || '';
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(misspelledWord, from);
      if (idx === -1) break;
      const range = document.createRange();
      range.setStart(textNode, idx);
      range.setEnd(textNode, idx + misspelledWord.length);
      const dist = caretRange ? distanceToRange(caretRange, range) : (best ? 1 : 0);
      if (dist < bestDist) {
        bestDist = dist;
        best = range;
      }
      from = idx + misspelledWord.length;
    }
  }

  return best;
}

function collapseCaretAfter(range) {
  const sel = window.getSelection();
  if (!sel) return;
  const caret = range.cloneRange();
  caret.collapse(false);
  sel.removeAllRanges();
  sel.addRange(caret);
}

function replaceMisspelledWord(rootEl, misspelledWord, correction, options) {
  if (!rootEl || !misspelledWord || !correction) return false;

  const selection = window.getSelection();
  const range = findMisspelledRange(rootEl, misspelledWord, selection, options);
  if (!range) return false;

  selection.removeAllRanges();
  selection.addRange(range);

  let replaced = false;
  if (typeof document.execCommand === 'function') {
    replaced = document.execCommand('insertText', false, correction);
  }
  if (!replaced) {
    range.deleteContents();
    const textNode = document.createTextNode(correction);
    range.insertNode(textNode);
    const after = document.createRange();
    after.setStart(textNode, correction.length);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
    return true;
  }

  collapseCaretAfter(selection.getRangeAt(0));
  return true;
}

if (typeof window !== 'undefined') {
  window.SpellReplace = { replaceMisspelledWord, findMisspelledRange, findRangeAtPoint };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { replaceMisspelledWord, findMisspelledRange, findRangeAtPoint };
}