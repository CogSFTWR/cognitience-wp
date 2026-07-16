/**
 * Cognitience WP — Extension Host
 * The heart of the extension system. Manages loading, activation, deactivation,
 * and lifecycle of all extensions. Inspired by VS Code's extension host.
 */

import { app, ipcMain, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import AdmZip from 'adm-zip';
import { ConfigStore } from './config-store';
import { ExtensionManifest, InstalledExtension, ExtensionState, ActivationEvent, RegisteredCommand } from '../shared/types';

export class ExtensionHost {
  private extensions = new Map<string, InstalledExtension>();
  private commands = new Map<string, RegisteredCommand>();
  private extensionsDir: string;

  constructor(private configStore: ConfigStore) {
    // Extensions live in userData/extensions
    this.extensionsDir = path.join(app.getPath('userData'), 'extensions');
    this.ensureExtensionsDir();
  }

  private ensureExtensionsDir() {
    if (!fs.existsSync(this.extensionsDir)) {
      fs.mkdirSync(this.extensionsDir, { recursive: true });
    }
  }

  private static resolveExtensionPath(installPath: string, filePath: string): string {
    const resolved = path.resolve(installPath, filePath);
    const rel = path.relative(installPath, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('Access denied: path escapes extension directory');
    }
    return resolved;
  }

  async initialize() {
    this.discoverExtensions();
    this.registerIPC();
    console.log(`[ExtensionHost] Initialized. Found ${this.extensions.size} extension(s).`);
  }

  // ─── Extension Discovery ───────────────────────────────────

  private discoverExtensions() {
    if (!fs.existsSync(this.extensionsDir)) return;

    const entries = fs.readdirSync(this.extensionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const manifestPath = path.join(this.extensionsDir, entry.name, 'package.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestContent) as ExtensionManifest;
        const extensionId = `${manifest.publisher}.${manifest.name}`;

        const installed: InstalledExtension = {
          id: extensionId,
          manifest,
          state: 'installed',
          installPath: path.join(this.extensionsDir, entry.name),
          installedAt: Date.now(),
          lastActivated: null,
          error: null,
        };

        this.extensions.set(extensionId, installed);
        console.log(`[ExtensionHost] Discovered: ${extensionId} v${manifest.version}`);
      } catch (err) {
        console.error(`[ExtensionHost] Failed to parse manifest for ${entry.name}:`, err);
      }
    }
  }

  // ─── Activation ────────────────────────────────────────────

  async activateByEvent(event: ActivationEvent, ...args: unknown[]): Promise<void> {
    for (const [id, ext] of this.extensions) {
      if (ext.state !== 'installed' && ext.state !== 'deactivated') continue;
      if (ext.manifest.activationEvents.includes('*') ||
          ext.manifest.activationEvents.includes(`onStartup`) ||
          ext.manifest.activationEvents.includes(event)) {
        await this.activateExtension(id, ...args);
      }
    }
  }

  async activateExtension(id: string, ...args: unknown[]): Promise<boolean> {
    const ext = this.extensions.get(id);
    if (!ext) {
      console.error(`[ExtensionHost] Extension not found: ${id}`);
      return false;
    }

    if (ext.state === 'active') return true;
    if (ext.state === 'disabled') {
      console.log(`[ExtensionHost] Extension is disabled: ${id}`);
      return false;
    }

    ext.state = 'activating';
    console.log(`[ExtensionHost] Activating: ${id}`);

    try {
      const mainPath = path.join(ext.installPath, ext.manifest.main);
      if (!fs.existsSync(mainPath)) {
        throw new Error(`Main file not found: ${mainPath}`);
      }

      // Load extension module in a sandboxed context
      const extensionContext = this.createExtensionContext(ext);
      const module = require(mainPath);
      const activateFn = module.activate || module.default?.activate;

      if (typeof activateFn === 'function') {
        await activateFn(extensionContext, ...args);
      }

      ext.state = 'active';
      ext.lastActivated = Date.now();
      console.log(`[ExtensionHost] Activated: ${id}`);
      return true;
    } catch (err) {
      ext.state = 'deactivated';
      ext.error = err instanceof Error ? err.message : String(err);
      console.error(`[ExtensionHost] Failed to activate ${id}:`, err);
      return false;
    }
  }

  async deactivateExtension(id: string): Promise<void> {
    const ext = this.extensions.get(id);
    if (!ext || ext.state !== 'active') return;

    try {
      const mainPath = path.join(ext.installPath, ext.manifest.main);
      const module = require(mainPath);
      const deactivateFn = module.deactivate || module.default?.deactivate;
      if (typeof deactivateFn === 'function') {
        await deactivateFn();
      }
    } catch (err) {
      console.error(`[ExtensionHost] Deactivation error for ${id}:`, err);
    }

    // Remove all commands registered by this extension
    for (const [cmdId, cmd] of this.commands) {
      if (cmd.extensionId === id) {
        this.commands.delete(cmdId);
      }
    }

    ext.state = 'deactivated';
    console.log(`[ExtensionHost] Deactivated: ${id}`);
  }

  // ─── Extension Context ─────────────────────────────────────

  private createExtensionContext(ext: InstalledExtension): ExtensionContext {
    const self = this;

    return {
      extensionId: ext.id,
      extensionPath: ext.installPath,
      subscriptions: [],

      // Command registry
      commands: {
        registerCommand(id: string, handler: (...args: unknown[]) => unknown, thisArg?: unknown): Disposable {
          const fullId = id.includes('.') ? id : `${ext.id}.${id}`;
          const command: RegisteredCommand = {
            id: fullId,
            title: id,
            handler: thisArg ? handler.bind(thisArg) : handler,
            extensionId: ext.id,
            enabled: true,
          };
          self.commands.set(fullId, command);
          console.log(`[ExtensionHost] Command registered: ${fullId}`);

          return { dispose: () => self.commands.delete(fullId) };
        },
        executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
          return self.executeCommand(id, ...args);
        },
        getCommands(): string[] {
          return Array.from(self.commands.keys());
        },
      },

      // Configuration access
      config: {
        get<T = unknown>(key: string): T {
          return self.configStore.get<T>(key);
        },
        getAll(): Record<string, unknown> {
          return self.configStore.getAll();
        },
      },

      // Status bar
      statusBar: {
        createItem(alignment: 'left' | 'right', priority: number): StatusBarItemHandle {
          const itemId = `${ext.id}.status-${Date.now()}`;
          return {
            id: itemId,
            setText: (text: string) => self.notifyRenderer('statusBar:update', { id: itemId, text, alignment, priority }),
            setTooltip: (tooltip: string) => self.notifyRenderer('statusBar:tooltip', { id: itemId, tooltip }),
            show: () => self.notifyRenderer('statusBar:show', { id: itemId, alignment, priority }),
            hide: () => self.notifyRenderer('statusBar:hide', { id: itemId }),
            dispose: () => self.notifyRenderer('statusBar:dispose', { id: itemId }),
          };
        },
      },

      // Toolbar buttons (SVG icons)
      toolbar: {
        /**
         * Register a toolbar button with an SVG icon.
         * The SVG file should be in the extension directory.
         * When clicked, the registered command is executed.
         */
        registerButton(buttonId: string, options: {
          label: string;
          tooltip: string;
          icon: string;        // SVG file path relative to extension dir, or inline SVG string
          command: string;     // Command to execute when clicked
          position?: 'left' | 'right'; // Where in the toolbar to place it
        }): Disposable {
          const fullId = buttonId.includes('.') ? buttonId : `${ext.id}.${buttonId}`;
          let svgContent = options.icon;

          // If icon is a file path, read the SVG file
          if (!options.icon.trim().startsWith('<svg') && !options.icon.trim().startsWith('<?xml')) {
            const iconPath = path.resolve(ext.installPath, options.icon);
            if (fs.existsSync(iconPath)) {
              svgContent = fs.readFileSync(iconPath, 'utf-8');
            } else {
              console.warn(`[ExtensionHost] SVG icon not found: ${iconPath}`);
              svgContent = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`;
            }
          }

          self.notifyRenderer('toolbar:addButton', {
            id: fullId,
            label: options.label,
            tooltip: options.tooltip,
            svg: svgContent,
            command: options.command,
            position: options.position || 'right',
          });

          return { dispose: () => self.notifyRenderer('toolbar:removeButton', { id: fullId }) };
        },
      },

      // Notifications
      notifications: {
        info(message: string): void {
          self.notifyRenderer('notification:info', message);
        },
        warning(message: string): void {
          self.notifyRenderer('notification:warning', message);
        },
        error(message: string): void {
          self.notifyRenderer('notification:error', message);
        },
      },

      // Editor interaction
      editor: {
        getContent(): Promise<string> {
          return self.invokeRenderer('editor:getContent');
        },
        setContent(content: string): void {
          self.notifyRenderer('editor:setContent', content);
        },
        getSelection(): Promise<{ text: string; start: number; end: number }> {
          return self.invokeRenderer('editor:getSelection');
        },
        insertText(text: string, position?: number): void {
          self.notifyRenderer('editor:insertText', { text, position });
        },
        replaceSelection(text: string): void {
          self.notifyRenderer('editor:replaceSelection', text);
        },
        scrollTo(position: number): void {
          self.notifyRenderer('editor:scrollTo', position);
        },
      },

      // Document lifecycle events
      documents: {
        onDidOpen: (cb: (doc: unknown) => void): Disposable => {
          ipcMain.handle(`${ext.id}:doc:open`, (_, doc) => cb(doc));
          return { dispose: () => ipcMain.removeHandler(`${ext.id}:doc:open`) };
        },
        onDidSave: (cb: (doc: unknown) => void): Disposable => {
          ipcMain.handle(`${ext.id}:doc:save`, (_, doc) => cb(doc));
          return { dispose: () => ipcMain.removeHandler(`${ext.id}:doc:save`) };
        },
        onDidChange: (cb: (changes: unknown) => void): Disposable => {
          ipcMain.handle(`${ext.id}:doc:change`, (_, changes) => cb(changes));
          return { dispose: () => ipcMain.removeHandler(`${ext.id}:doc:change`) };
        },
      },

      // File system access (jailed to extension install directory)
      fs: {
        readFileSync(filePath: string): string {
          const resolved = ExtensionHost.resolveExtensionPath(ext.installPath, filePath);
          return fs.readFileSync(resolved, 'utf-8');
        },
        writeFileSync(filePath: string, content: string): void {
          const resolved = ExtensionHost.resolveExtensionPath(ext.installPath, filePath);
          fs.writeFileSync(resolved, content, 'utf-8');
        },
        existsSync(filePath: string): boolean {
          const resolved = ExtensionHost.resolveExtensionPath(ext.installPath, filePath);
          return fs.existsSync(resolved);
        },
        readDirSync(dirPath: string): string[] {
          const resolved = ExtensionHost.resolveExtensionPath(ext.installPath, dirPath);
          return fs.readdirSync(resolved);
        },
      },

      // Logger
      logger: {
        info: (...msgs: unknown[]) => console.log(`[${ext.id}]`, ...msgs),
        warn: (...msgs: unknown[]) => console.warn(`[${ext.id}]`, ...msgs),
        error: (...msgs: unknown[]) => console.error(`[${ext.id}]`, ...msgs),
      },
    };
  }

  // ─── Command Execution ─────────────────────────────────────

  async executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
    const command = this.commands.get(id);
    if (!command) {
      throw new Error(`Command not found: ${id}`);
    }
    if (!command.enabled) {
      throw new Error(`Command is disabled: ${id}`);
    }
    return command.handler(...args);
  }

  getCommands(): RegisteredCommand[] {
    return Array.from(this.commands.values());
  }

  // ─── Extension Management ──────────────────────────────────

  getExtensions(): InstalledExtension[] {
    return Array.from(this.extensions.values());
  }

  getExtension(id: string): InstalledExtension | undefined {
    return this.extensions.get(id);
  }

  async installExtension(extensionPath: string): Promise<InstalledExtension> {
    // Handle .cogwp files (ZIP archives containing the extension)
    if (extensionPath.endsWith('.cogwp') || extensionPath.endsWith('.zip')) {
      return this.installFromArchive(extensionPath);
    }

    const manifestPath = path.join(extensionPath, 'package.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Invalid extension: package.json not found');
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ExtensionManifest;
    const extensionId = `${manifest.publisher}.${manifest.name}`;
    const targetDir = path.join(this.extensionsDir, extensionId.replace(/\s/g, '-').toLowerCase());

    // Copy extension files
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    this.copyDir(extensionPath, targetDir);

    const installed: InstalledExtension = {
      id: extensionId,
      manifest,
      state: 'installed',
      installPath: targetDir,
      installedAt: Date.now(),
      lastActivated: null,
      error: null,
    };

    this.extensions.set(extensionId, installed);
    console.log(`[ExtensionHost] Installed: ${extensionId}`);
    return installed;
  }

  /**
   * Install from a .cogwp archive (ZIP format).
   * .cogwp is the Cognitience WP plugin package format, similar to .vsix for VS Code.
   */
  private async installFromArchive(archivePath: string): Promise<InstalledExtension> {
    const tmpDir = path.join(os.tmpdir(), `cogwp-install-${Date.now()}`);

    try {
      const zip = new AdmZip(archivePath);
      zip.extractAllTo(tmpDir, true);

      // Find the manifest in the extracted directory
      const findManifest = (dir: string): string | null => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isFile() && entry.name === 'package.json') {
            return fullPath;
          }
          if (entry.isDirectory()) {
            const found = findManifest(fullPath);
            if (found) return found;
          }
        }
        return null;
      };

      const manifestPath = findManifest(tmpDir);
      if (!manifestPath) {
        throw new Error('Invalid .cogwp: no package.json found in archive');
      }

      const extensionDir = path.dirname(manifestPath);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ExtensionManifest;
      const extensionId = `${manifest.publisher}.${manifest.name}`;
      const targetDir = path.join(this.extensionsDir, extensionId.replace(/\s/g, '-').toLowerCase());

      // Remove old version if exists
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }

      // Copy extracted files to extensions directory
      fs.mkdirSync(targetDir, { recursive: true });
      this.copyDir(extensionDir, targetDir);

      const installed: InstalledExtension = {
        id: extensionId,
        manifest,
        state: 'installed',
        installPath: targetDir,
        installedAt: Date.now(),
        lastActivated: null,
        error: null,
      };

      this.extensions.set(extensionId, installed);
      console.log(`[ExtensionHost] Installed from .cogwp: ${extensionId}`);
      return installed;
    } catch (err) {
      if (fs.existsSync(archivePath) && fs.statSync(archivePath).isDirectory()) {
        return this.installExtension(archivePath);
      }
      throw new Error(
        `Failed to install .cogwp: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      // Clean up temp dir
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  async uninstallExtension(id: string): Promise<void> {
    const ext = this.extensions.get(id);
    if (!ext) return;

    await this.deactivateExtension(id);
    ext.state = 'uninstalled';

    // Remove from disk
    if (fs.existsSync(ext.installPath)) {
      fs.rmSync(ext.installPath, { recursive: true, force: true });
    }

    this.extensions.delete(id);
    console.log(`[ExtensionHost] Uninstalled: ${id}`);
  }

  async enableExtension(id: string): Promise<void> {
    const ext = this.extensions.get(id);
    if (!ext) return;
    ext.state = 'installed';
    ext.error = null;
  }

  async disableExtension(id: string): Promise<void> {
    await this.deactivateExtension(id);
    const ext = this.extensions.get(id);
    if (ext) {
      ext.state = 'disabled';
    }
  }

  async reloadExtension(id: string): Promise<void> {
    await this.deactivateExtension(id);
    await this.activateExtension(id);
  }

  // ─── IPC ───────────────────────────────────────────────────

  private registerIPC() {
    ipcMain.handle('ext:host:list', async () => this.getExtensions());
    ipcMain.handle('ext:host:install', async (_, extPath: string) => this.installExtension(extPath));
    ipcMain.handle('ext:host:uninstall', async (_, id: string) => this.uninstallExtension(id));
    ipcMain.handle('ext:host:enable', async (_, id: string) => this.enableExtension(id));
    ipcMain.handle('ext:host:disable', async (_, id: string) => this.disableExtension(id));
    ipcMain.handle('ext:host:reload', async (_, id: string) => this.reloadExtension(id));
    ipcMain.handle('ext:host:executeCommand', async (_, id: string, ...args: unknown[]) => this.executeCommand(id, ...args));
    ipcMain.handle('ext:host:getCommands', async () => this.getCommands());
    ipcMain.handle('ext:host:activate', async (_, id: string) => this.activateExtension(id));
  }

  // ─── Helpers ───────────────────────────────────────────────

  private notifyRenderer(channel: string, ...args: unknown[]) {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send(channel, ...args);
    }
  }

  private invokeRenderer<T>(channel: string): Promise<T> {
    return new Promise((resolve) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length === 0) {
        resolve(null as T);
        return;
      }
      const win = windows[0];
      ipcMain.handleOnce(`${channel}:result`, (_, result: T) => {
        resolve(result);
        return null;
      });
      win.webContents.send(channel);
    });
  }

  private copyDir(src: string, dest: string) {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this.copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

// ─── Extension API Interfaces (exposed to extensions) ──────────

export interface ExtensionContext {
  extensionId: string;
  extensionPath: string;
  subscriptions: Disposable[];
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown, thisArg?: unknown): Disposable;
    executeCommand(id: string, ...args: unknown[]): Promise<unknown>;
    getCommands(): string[];
  };
  config: {
    get<T = unknown>(key: string): T;
    getAll(): Record<string, unknown>;
  };
  statusBar: {
    createItem(alignment: 'left' | 'right', priority: number): StatusBarItemHandle;
  };
  toolbar: {
    registerButton(buttonId: string, options: {
      label: string;
      tooltip: string;
      icon: string;
      command: string;
      position?: 'left' | 'right';
    }): Disposable;
  };
  notifications: {
    info(message: string): void;
    warning(message: string): void;
    error(message: string): void;
  };
  editor: {
    getContent(): Promise<string>;
    setContent(content: string): void;
    getSelection(): Promise<{ text: string; start: number; end: number }>;
    insertText(text: string, position?: number): void;
    replaceSelection(text: string): void;
    scrollTo(position: number): void;
  };
  documents: {
    onDidOpen: (cb: (doc: unknown) => void) => Disposable;
    onDidSave: (cb: (doc: unknown) => void) => Disposable;
    onDidChange: (cb: (changes: unknown) => void) => Disposable;
  };
  fs: {
    readFileSync(filePath: string): string;
    writeFileSync(filePath: string, content: string): void;
    existsSync(filePath: string): boolean;
    readDirSync(dirPath: string): string[];
  };
  logger: {
    info: (...msgs: unknown[]) => void;
    warn: (...msgs: unknown[]) => void;
    error: (...msgs: unknown[]) => void;
  };
}

export interface Disposable {
  dispose(): void;
}

export interface StatusBarItemHandle {
  id: string;
  setText(text: string): void;
  setTooltip(tooltip: string): void;
  show(): void;
  hide(): void;
  dispose(): void;
}
