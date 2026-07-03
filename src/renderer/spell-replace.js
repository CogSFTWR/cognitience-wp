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

function findMisspelledRange(rootEl, misspelledWord, selection) {
  if (!rootEl || !misspelledWord || !selection) return null;

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

function replaceMisspelledWord(rootEl, misspelledWord, correction) {
  if (!rootEl || !misspelledWord || !correction) return false;

  const selection = window.getSelection();
  if (!selection) return false;

  const range = findMisspelledRange(rootEl, misspelledWord, selection);
  if (!range) return false;

  selection.removeAllRanges();
  selection.addRange(range);
  let replaced = false;
  if (typeof document.execCommand === 'function') {
    replaced = document.execCommand('insertText', false, correction);
  }
  if (!replaced) {
    range.deleteContents();
    range.insertNode(document.createTextNode(correction));
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return true;
}

if (typeof window !== 'undefined') {
  window.SpellReplace = { replaceMisspelledWord, findMisspelledRange };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { replaceMisspelledWord, findMisspelledRange };
}