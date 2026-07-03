/**
 * Cognitience WP — Spellcheck helpers (shared between preload and tests).
 * Backend wraps Electron webFrame.isWordMisspelled / getWordSuggestions.
 */

export interface SpellBackend {
  isWordMisspelled(word: string): boolean;
  getWordSuggestions(word: string): string[];
}

export interface SpellCheckResult {
  correct: boolean;
  suggestions: string[];
}

export interface SpellTextError {
  word: string;
  start: number;
  end: number;
  suggestions: string[];
}

const WORD_REGEX = /[a-zA-Z]+(?:'[a-zA-Z]+)?/g;

export function checkWord(backend: SpellBackend, word: string): SpellCheckResult {
  const isMisspelled = backend.isWordMisspelled(word);
  const suggestions = isMisspelled ? backend.getWordSuggestions(word).slice(0, 8) : [];
  return { correct: !isMisspelled, suggestions };
}

export function checkText(backend: SpellBackend, text: string): SpellTextError[] {
  const errors: SpellTextError[] = [];
  const regex = new RegExp(WORD_REGEX.source, WORD_REGEX.flags);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const word = match[0];
    if (word.length <= 1) continue;
    if (word === word.toUpperCase() && word.length > 1) continue;
    if (backend.isWordMisspelled(word)) {
      errors.push({
        word,
        start: match.index,
        end: match.index + word.length,
        suggestions: backend.getWordSuggestions(word).slice(0, 5),
      });
    }
  }
  return errors;
}