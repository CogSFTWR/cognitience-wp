/**
 * Cognitience WP — Custom dictionary preload for Hunspell.
 * Loads persisted words from config into the Electron spellchecker session.
 */

import { BrowserWindow } from 'electron';
import { ConfigStore } from './config-store';

export function preloadCustomDictionary(window: BrowserWindow, configStore: ConfigStore): void {
  const customWords = configStore.get<string[]>('editor.customDictionary') || [];
  const session = window.webContents.session;
  for (const word of customWords) {
    if (word && typeof word === 'string') {
      session.addWordToSpellCheckerDictionary(word);
    }
  }
}