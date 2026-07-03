/**
 * Cognitience WP — Spell IPC handlers (shared entry for IPCMainRegistry + tests).
 */

import { ipcMain } from 'electron';
import { WindowManager } from './window-manager';
import { clearLastSpellContext, getLastSpellContext } from './spell-context';

export function registerSpellIpcHandlers(windowManager: WindowManager): void {
  ipcMain.handle('spell:getContext', async () => getLastSpellContext());

  ipcMain.handle('spell:clearContext', async () => {
    clearLastSpellContext();
    return { success: true };
  });

  ipcMain.handle('spell:addWord', async (_, word: string) => {
    const win = windowManager.getMainWindow();
    if (!win) return { success: false };
    win.webContents.session.addWordToSpellCheckerDictionary(word);
    return { success: true };
  });
}