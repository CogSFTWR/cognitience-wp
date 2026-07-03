/**
 * Cognitience WP — Preload Script
 * Secure bridge between renderer and main process.
 * Exposes a controlled API via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

let lastSpellContext: {
  misspelledWord: string;
  suggestions: string[];
  x: number;
  y: number;
} | null = null;

ipcRenderer.on('spell:contextMenu', (_event, data) => {
  lastSpellContext = data;
});

const cognitionAPI = {
  // ─── Document Operations ────────────────────────────────────
  documents: {
    new: () => ipcRenderer.invoke('doc:new'),
    open: (filePath?: string) => ipcRenderer.invoke('doc:open', filePath),
    save: (data: { content: string; filePath: string; format: string }) =>
      ipcRenderer.invoke('doc:save', data),
    saveAs: (data: { content: string; format: string; title: string }) =>
      ipcRenderer.invoke('doc:saveAs', data),
    export: (data: { format: string; content: string; title: string }) =>
      ipcRenderer.invoke('doc:export', data),
    import: (filePath: string) => ipcRenderer.invoke('doc:import', filePath),
    onOpen: (callback: (filePath: string) => void) => {
      ipcRenderer.on('file:open', (_, filePath) => callback(filePath));
    },
  },

  // ─── Extension Management ──────────────────────────────────
  extensions: {
    list: () => ipcRenderer.invoke('ext:list'),
    install: (extensionPath: string) => ipcRenderer.invoke('ext:install', extensionPath),
    uninstall: (extensionId: string) => ipcRenderer.invoke('ext:uninstall', extensionId),
    enable: (extensionId: string) => ipcRenderer.invoke('ext:enable', extensionId),
    disable: (extensionId: string) => ipcRenderer.invoke('ext:disable', extensionId),
    reload: (extensionId: string) => ipcRenderer.invoke('ext:reload', extensionId),
    executeCommand: (commandId: string, ...args: unknown[]) =>
      ipcRenderer.invoke('ext:executeCommand', commandId, ...args),
    getCommands: () => ipcRenderer.invoke('ext:getCommands'),
    onInstallRequest: (callback: (path: string) => void) => {
      ipcRenderer.on('ext:installRequest', (_, path) => callback(path));
    },
    onEvent: (callback: (event: string, data: unknown) => void) => {
      ipcRenderer.on('ext:event', (_, event, data) => callback(event, data));
    },
    scaffoldPlugin: () => ipcRenderer.invoke('ext:scaffoldPlugin'),
  },

  // ─── Configuration ────────────────────────────────────────
  config: {
    get: (key: string) => ipcRenderer.invoke('config:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('config:set', key, value),
    getAll: () => ipcRenderer.invoke('config:getAll'),
    onChanged: (callback: (key: string, value: unknown) => void) => {
      ipcRenderer.on('config:changed', (_, data) => callback(data.key, data.value));
    },
  },

  // ─── Theme ────────────────────────────────────────────────
  theme: {
    get: () => ipcRenderer.invoke('theme:get'),
    set: (themeId: string) => ipcRenderer.invoke('theme:set', themeId),
    list: () => ipcRenderer.invoke('theme:list'),
    onChanged: (callback: (themeId: string) => void) => {
      ipcRenderer.on('theme:changed', (_, themeId) => callback(themeId));
    },
  },

  // ─── Clipboard ────────────────────────────────────────────
  clipboard: {
    write: (text: string) => ipcRenderer.invoke('clipboard:write', text),
    read: () => ipcRenderer.invoke('clipboard:read'),
  },

  // ─── File System ──────────────────────────────────────────
  fs: {
    read: (filePath: string) => ipcRenderer.invoke('fs:read', filePath),
    write: (filePath: string, content: string) =>
      ipcRenderer.invoke('fs:write', filePath, content),
    exists: (filePath: string) => ipcRenderer.invoke('fs:exists', filePath),
    mkdir: (dirPath: string) => ipcRenderer.invoke('fs:mkdir', dirPath),
    browseImage: () => ipcRenderer.invoke('fs:browseImage'),
  },

  // ─── Window Controls ──────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    fullscreen: () => ipcRenderer.invoke('win:fullscreen'),
  },

  // ─── Event Listeners ──────────────────────────────────────
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = [
      'doc:new', 'doc:open', 'doc:save', 'doc:saveAs', 'doc:export', 'doc:print',
      'doc:pageSetup',
      'file:open',
      'insert:heading', 'insert:bold', 'insert:italic', 'insert:underline',
      'insert:strikethrough', 'insert:link', 'insert:image', 'insert:table',
      'insert:codeBlock', 'insert:quote', 'insert:hr', 'insert:list',
      'insert:template',
      'format:align', 'format:fontSize', 'format:subscript', 'format:superscript',
      'format:highlight', 'format:clear',
      'view:toggleSidebar', 'view:toggleOutline', 'view:toggleFocusMode',
      'view:toggleFullscreen', 'view:zoomIn', 'view:zoomOut', 'view:zoomReset',
      'view:commandPalette',
      'editor:find', 'editor:replace', 'editor:findNext', 'editor:findPrev',
      'editor:getContent', 'editor:getSelection',
      'tools:wordCount', 'tools:settings',
      'ext:installRequest', 'ext:browse', 'ext:manage', 'ext:reloadAll', 'ext:createNew', 'ext:docs',
      'config:changed', 'theme:changed',
      'statusBar:update', 'statusBar:tooltip', 'statusBar:show', 'statusBar:hide', 'statusBar:dispose',
      'toolbar:addButton', 'toolbar:removeButton',
      'notification:info', 'notification:warning', 'notification:error',
      'help:shortcuts', 'help:checkUpdates',
      'spell:contextMenu',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args));
    }
  },

  // ─── Platform Info ─────────────────────────────────────────
  version: process.argv
    .find((arg) => arg.startsWith('--cognitience-version='))
    ?.slice('--cognitience-version='.length) ?? '',
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },

  // ─── Update Checker ────────────────────────────────────────
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
    downloadAndInstall: (url: string) => ipcRenderer.invoke('updates:downloadAndInstall', url),
  },

  // ─── Spellcheck (native Hunspell via context-menu + session dictionary) ──
  spell: {
    getContext: () => {
      if (lastSpellContext) return Promise.resolve(lastSpellContext);
      return ipcRenderer.invoke('spell:getContext');
    },
    waitForContext: (timeoutMs = 400) => {
      if (lastSpellContext) return Promise.resolve(lastSpellContext);
      return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const poll = () => {
          if (lastSpellContext) {
            resolve(lastSpellContext);
            return;
          }
          if (Date.now() >= deadline) {
            ipcRenderer.invoke('spell:getContext').then(resolve);
            return;
          }
          setTimeout(poll, 10);
        };
        poll();
      });
    },
    clearContext: () => {
      lastSpellContext = null;
      return ipcRenderer.invoke('spell:clearContext');
    },
    addWord: (word: string) => ipcRenderer.invoke('spell:addWord', word),
    setSessionEnabled: (enabled: boolean) =>
      ipcRenderer.invoke('spell:setSessionEnabled', enabled),
  },

  // ─── External Plugin Host (JSON-RPC) ───────────────────────
  plugins: {
    list: () => ipcRenderer.invoke('plugin:list'),
    start: (id: string) => ipcRenderer.invoke('plugin:start', id),
    stop: (id: string) => ipcRenderer.invoke('plugin:stop', id),
    running: () => ipcRenderer.invoke('plugin:running'),
  },
};

// Expose the API to the renderer
contextBridge.exposeInMainWorld('cognitience', cognitionAPI);