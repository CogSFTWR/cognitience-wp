/**
 * Cognitience WP — Native spell suggestions via Electron context-menu event.
 * Chromium/Hunspell populates misspelledWord + dictionarySuggestions on right-click.
 */

import { BrowserWindow } from 'electron';

export interface SpellContextParams {
  misspelledWord: string;
  suggestions: string[];
  x: number;
  y: number;
}

let lastSpellContext: SpellContextParams | null = null;

export function getLastSpellContext(): SpellContextParams | null {
  return lastSpellContext;
}

export function clearLastSpellContext(): void {
  lastSpellContext = null;
}

export function handleSpellContextParams(
  window: BrowserWindow,
  params: Electron.ContextMenuParams,
): SpellContextParams | null {
  if (!params.misspelledWord) {
    lastSpellContext = null;
    return null;
  }
  lastSpellContext = {
    misspelledWord: params.misspelledWord,
    suggestions: params.dictionarySuggestions || [],
    x: params.x,
    y: params.y,
  };
  window.webContents.send('spell:contextMenu', lastSpellContext);
  return lastSpellContext;
}

export function attachSpellContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    handleSpellContextParams(window, params);
  });
}