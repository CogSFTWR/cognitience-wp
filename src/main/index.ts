/**
 * Cognitience WP — Main Process Entry Point
 * The VS Code of word processors.
 */

import { app, BrowserWindow, ipcMain, Menu, dialog, shell, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { WindowManager } from './window-manager';
import { IPCMainRegistry } from './ipc-registry';
import { ExtensionHost } from './extension-host';
import { ConfigStore } from './config-store';
import { MenuBuilder } from './menu-builder';
import { PluginHost } from './plugin-host';
import { preloadCustomDictionary } from './spell-dictionary';
import { attachSpellContextMenu } from './spell-context';

let mainWindow: BrowserWindow | null = null;
let windowManager: WindowManager;
let extensionHost: ExtensionHost;
let pluginHost: PluginHost | null = null;
let configStore: ConfigStore;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.whenReady().then(async () => {
  // Initialize config store
  configStore = new ConfigStore();

  // Initialize extension host
  extensionHost = new ExtensionHost(configStore);
  await extensionHost.initialize();

  // Initialize external plugin host (JSON-RPC over stdio)
  pluginHost = new PluginHost();

  // Create window manager and register IPC before spell/dictionary setup uses handlers
  windowManager = new WindowManager(configStore, extensionHost);
  const ipcRegistry = new IPCMainRegistry(windowManager, extensionHost, configStore, pluginHost);
  ipcRegistry.registerAll();

  mainWindow = windowManager.createMainWindow();

  // Pre-load custom dictionary words into Hunspell session
  if (mainWindow) {
    mainWindow.webContents.session.setSpellCheckerLanguages(['en-US']);
    mainWindow.webContents.session.setSpellCheckerEnabled(true);
    attachSpellContextMenu(mainWindow);
    preloadCustomDictionary(mainWindow, configStore);
  }

  // Build and set menu
  const menuBuilder = new MenuBuilder(windowManager, extensionHost, configStore);
  Menu.setApplicationMenu(menuBuilder.buildMenu());

  // Activate startup extensions
  await extensionHost.activateByEvent('onStartup');

  // Handle file open from OS
  const openFile = process.argv.find(arg => !arg.startsWith('-') && path.isAbsolute(arg) && (arg.endsWith('.cog') || arg.endsWith('.md') || arg.endsWith('.txt') || arg.endsWith('.doc') || arg.endsWith('.docx') || arg.endsWith('.pdf') || arg.endsWith('.html')));
  if (openFile && mainWindow) {
    windowManager.openFile(openFile);
  }

  console.log('[Cognitience WP] Application started successfully');
});

app.on('window-all-closed', () => {
  pluginHost?.stopAllPlugins();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  pluginHost?.stopAllPlugins();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = windowManager.createMainWindow();
  }
});

// Handle file open events (macOS)
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    windowManager.openFile(filePath);
  }
});

// Security: prevent navigation to external content
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (!parsedUrl.origin.startsWith('file://')) {
      event.preventDefault();
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});
