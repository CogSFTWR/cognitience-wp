/**
 * Cognitience WP — IPC Registry
 * Registers all IPC handlers between the main process and renderer.
 */

import { ipcMain, dialog, clipboard, shell, BrowserWindow, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { marked } from 'marked';
import mammoth from 'mammoth';
import { WindowManager } from './window-manager';
import { ExtensionHost } from './extension-host';
import { ConfigStore } from './config-store';
import { ExportManager } from './export-manager';
import { PluginHost } from './plugin-host';
import { BUILTIN_THEMES } from '../shared/constants';

export class IPCMainRegistry {
  private exportManager: ExportManager;

  constructor(
    private windowManager: WindowManager,
    private extensionHost: ExtensionHost,
    private configStore: ConfigStore,
    private pluginHost: PluginHost,
  ) {
    this.exportManager = new ExportManager();
  }

  registerAll() {
    this.registerDocumentHandlers();
    this.registerExtensionHandlers();
    this.registerConfigHandlers();
    this.registerThemeHandlers();
    this.registerClipboardHandlers();
    this.registerFileHandlers();
    this.registerWindowHandlers();
    this.registerUpdateHandlers();
    this.registerPluginHandlers();
    this.registerPluginScaffoldHandler();
    this.registerSpellcheckHandlers();
  }

  // ─── Document Operations ───────────────────────────────────

  private registerDocumentHandlers() {
    ipcMain.handle('doc:new', async () => {
      this.windowManager.send('doc:new');
      return { success: true };
    });

    ipcMain.handle('doc:open', async (_, filePath?: string) => {
      if (!filePath) {
        const result = await dialog.showOpenDialog({
          title: 'Open Document',
          filters: [
            { name: 'All Supported', extensions: ['cog', 'md', 'txt', 'html', 'rtf', 'json', 'pdf', 'doc', 'docx'] },
            { name: 'Cognitience Document', extensions: ['cog'] },
            { name: 'Word Documents', extensions: ['doc', 'docx'] },
            { name: 'Markdown', extensions: ['md', 'markdown'] },
            { name: 'PDF', extensions: ['pdf'] },
            { name: 'Text', extensions: ['txt'] },
            { name: 'HTML', extensions: ['html', 'htm'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        filePath = result.filePaths[0];
      }

      const ext = path.extname(filePath).toLowerCase();
      let format = 'plaintext';
      let parsedContent = '';

      if (ext === '.cog') {
        const content = fs.readFileSync(filePath, 'utf-8');
        try {
          const parsed = this.exportManager.parseCogFile(content);
          if (!parsed) {
            format = 'plaintext';
            parsedContent = content;
          } else {
            parsedContent = parsed.html;
            format = 'cognitience';
          }
        } catch (e) {
          throw new Error(`Failed to open .cog file: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else if (ext === '.md' || ext === '.markdown') {
        const content = fs.readFileSync(filePath, 'utf-8');
        try {
          parsedContent = marked.parse(content) as string;
        } catch {
          // Fallback: basic markdown to HTML
          parsedContent = content
            .replace(/^### (.*)$/gm, '<h3>$1</h3>')
            .replace(/^## (.*)$/gm, '<h2>$1</h2>')
            .replace(/^# (.*)$/gm, '<h1>$1</h1>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .split('\n\n')
            .map(block => block.startsWith('<h') ? block : `<p>${block}</p>`)
            .join('\n');
        }
        format = 'markdown';
      } else if (ext === '.html' || ext === '.htm') {
        parsedContent = fs.readFileSync(filePath, 'utf-8');
        format = 'html';
      } else if (ext === '.txt' || ext === '.json' || ext === '.rtf') {
        const content = fs.readFileSync(filePath, 'utf-8');
        parsedContent = content.split('\n').map(line => `<p>${line || '&nbsp;'}</p>`).join('\n');
        format = 'plaintext';
      } else if (ext === '.doc' || ext === '.docx') {
        try {
          const result = await mammoth.convertToHtml({ path: filePath });
          parsedContent = result.value || '<p>(Empty document)</p>';
          format = 'word';
        } catch (e) {
          // Fallback for .doc (old binary format) — mammoth only supports .docx
          if (ext === '.doc') {
            const content = fs.readFileSync(filePath, 'utf-8');
            // Crude extraction: strip non-printable chars from old .doc binary
            const text = content.replace(/[^\x20-\x7E\r\n]/g, '').replace(/\r\n\r\n+/g, '\n\n').trim();
            parsedContent = text.split('\n\n').map(block => `<p>${block}</p>`).join('\n');
            format = 'word';
          } else {
            throw new Error(`Failed to open Word document: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } else if (ext === '.pdf') {
        // PDF: open with system viewer (Electron can't render PDFs natively in contenteditable)
        // We extract text using a basic approach
        try {
          const pdfBuffer = fs.readFileSync(filePath);
          // Basic PDF text extraction: find text in parentheses between BT...ET blocks
          const pdfText = pdfBuffer.toString('latin1');
          const textMatches: string[] = [];
          const regex = /\(([^)]+)\)/g;
          let match;
          while ((match = regex.exec(pdfText)) !== null) {
            const text = match[1].replace(/\\[nr()]/g, ' ').trim();
            if (text.length > 0 && textMatches.length < 10000) textMatches.push(text);
          }
          if (textMatches.length > 0) {
            parsedContent = textMatches.map(t => `<p>${t}</p>`).join('\n');
          } else {
            parsedContent = '<p>(PDF text could not be extracted. The PDF has been opened in your system viewer.)</p>';
            shell.openPath(filePath);
          }
          format = 'pdf';
        } catch (e) {
          // Last resort: open in system viewer
          shell.openPath(filePath);
          parsedContent = '<p>(PDF opened in system viewer)</p>';
          format = 'pdf';
        }
      } else {
        const content = fs.readFileSync(filePath, 'utf-8');
        parsedContent = content.split('\n').map(line => `<p>${line || '&nbsp;'}</p>`).join('\n');
        format = 'plaintext';
      }

      return {
        title: path.basename(filePath, ext),
        content: parsedContent,
        format,
        filePath,
      };
    });

    ipcMain.handle('doc:save', async (_, docData: { content: string; filePath: string; format: string; title: string }) => {
      let content = docData.content;

      if (docData.filePath.endsWith('.cog')) {
        content = this.exportManager.buildCogJson(docData.content, docData.title || 'Untitled', docData.filePath);
      }

      fs.writeFileSync(docData.filePath, content, 'utf-8');
      return { success: true, filePath: docData.filePath };
    });

    ipcMain.handle('doc:saveAs', async (_, docData: { content: string; format: string; title: string }) => {
      const filters: Electron.FileFilter[] = [
        { name: 'Cognitience Document', extensions: ['cog'] },
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Text', extensions: ['txt'] },
        { name: 'HTML', extensions: ['html'] },
        { name: 'All Files', extensions: ['*'] },
      ];

      const result = await dialog.showSaveDialog({
        title: 'Save Document',
        defaultPath: docData.title || 'Untitled',
        filters,
      });

      if (result.canceled || !result.filePath) return null;

      let content = docData.content;
      if (result.filePath.endsWith('.cog')) {
        // New file — no existing path to read metadata from
        content = this.exportManager.buildCogJson(docData.content, docData.title || 'Untitled', result.filePath);
      }

      fs.writeFileSync(result.filePath, content, 'utf-8');
      return { success: true, filePath: result.filePath };
    });

    ipcMain.handle('doc:export', async (_, data: { format: string; content: string; title: string }) => {
      return this.exportManager.exportDocument({
        format: data.format as any,
        content: data.content,
        title: data.title,
      });
    });

    ipcMain.handle('doc:import', async (_, filePath: string) => {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { content, filePath };
    });
  }

  // ─── Extension Operations ──────────────────────────────────

  private registerExtensionHandlers() {
    ipcMain.handle('ext:list', async () => {
      return this.extensionHost.getExtensions();
    });

    ipcMain.handle('ext:install', async (_, extensionPath: string) => {
      return this.extensionHost.installExtension(extensionPath);
    });

    ipcMain.handle('ext:uninstall', async (_, extensionId: string) => {
      return this.extensionHost.uninstallExtension(extensionId);
    });

    ipcMain.handle('ext:enable', async (_, extensionId: string) => {
      return this.extensionHost.enableExtension(extensionId);
    });

    ipcMain.handle('ext:disable', async (_, extensionId: string) => {
      return this.extensionHost.disableExtension(extensionId);
    });

    ipcMain.handle('ext:reload', async (_, extensionId: string) => {
      return this.extensionHost.reloadExtension(extensionId);
    });

    ipcMain.handle('ext:executeCommand', async (_, commandId: string, ...args: unknown[]) => {
      return this.extensionHost.executeCommand(commandId, ...args);
    });

    ipcMain.handle('ext:getCommands', async () => {
      return this.extensionHost.getCommands();
    });
  }

  // ─── Configuration ─────────────────────────────────────────

  private registerConfigHandlers() {
    ipcMain.handle('config:get', async (_, key: string) => {
      return this.configStore.get(key);
    });

    ipcMain.handle('config:set', async (_, key: string, value: unknown) => {
      this.configStore.set(key, value);
      // Notify renderer of config change
      this.windowManager.send('config:changed', { key, value });
      return { success: true };
    });

    ipcMain.handle('config:getAll', async () => {
      return this.configStore.getAll();
    });
  }

  // ─── Theme ─────────────────────────────────────────────────

  private registerThemeHandlers() {
    ipcMain.handle('theme:get', async () => {
      return this.configStore.get('theme.current');
    });

    ipcMain.handle('theme:set', async (_, themeId: string) => {
      this.configStore.set('theme.current', themeId);
      this.windowManager.send('theme:changed', themeId);
      return { success: true };
    });

    ipcMain.handle('theme:list', async () => {
      return BUILTIN_THEMES;
    });
  }

  // ─── Clipboard ────────────────────────────────────────────

  private registerClipboardHandlers() {
    ipcMain.handle('clipboard:write', async (_, text: string) => {
      clipboard.writeText(text);
      return { success: true };
    });

    ipcMain.handle('clipboard:read', async () => {
      return clipboard.readText();
    });
  }

  // ─── File System ──────────────────────────────────────────

  private registerFileHandlers() {
    ipcMain.handle('fs:read', async (_, filePath: string) => {
      try {
        return fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        throw new Error(`Failed to read file: ${err}`);
      }
    });

    ipcMain.handle('fs:write', async (_, filePath: string, content: string) => {
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    });

    ipcMain.handle('fs:exists', async (_, filePath: string) => {
      return fs.existsSync(filePath);
    });

    ipcMain.handle('fs:mkdir', async (_, dirPath: string) => {
      fs.mkdirSync(dirPath, { recursive: true });
      return { success: true };
    });

    ipcMain.handle('fs:browseImage', async () => {
      const result = await dialog.showOpenDialog({
        title: 'Select Image',
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    });
  }

  // ─── Window ───────────────────────────────────────────────

  private registerWindowHandlers() {
    ipcMain.handle('win:minimize', async () => {
      this.windowManager.getMainWindow()?.minimize();
    });

    ipcMain.handle('win:maximize', async () => {
      const win = this.windowManager.getMainWindow();
      if (win) {
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      }
    });

    ipcMain.handle('win:close', async () => {
      this.windowManager.getMainWindow()?.close();
    });

    ipcMain.handle('win:fullscreen', async () => {
      const win = this.windowManager.getMainWindow();
      if (win) {
        win.setFullScreen(!win.isFullScreen());
      }
    });
  }

  // ─── Update Checking ─────────────────────────────────────

  private registerUpdateHandlers() {
    ipcMain.handle('updates:check', async () => {
      try {
        const url = 'https://api.github.com/repos/wailonbrowngh/cognitience-wp/releases/latest';

        const data: string = await new Promise((resolve, reject) => {
          const req = https.get(url, {
            headers: {
              'User-Agent': 'cognitience-wp',
              'Accept': 'application/vnd.github.v3+json',
            },
          }, (res: any) => {
            let body = '';
            res.on('data', (chunk: string) => body += chunk);
            res.on('end', () => resolve(body));
          });
          req.on('error', reject);
          req.setTimeout(10000, () => req.destroy(new Error('timeout')));
        });

        const release = JSON.parse(data);
        const latestVersion = release.tag_name?.replace(/^v/, '') || '';
        const downloadUrl = release.assets?.find((a: any) =>
          a.name.endsWith('.exe') || a.name.endsWith('Setup.exe')
        )?.browser_download_url || release.html_url;

        const currentVersion = app.getVersion();
        return {
          currentVersion,
          latestVersion,
          updateAvailable: latestVersion && latestVersion !== currentVersion,
          downloadUrl,
          releaseNotes: release.body || '',
          releaseUrl: release.html_url || 'https://github.com/wailonbrowngh/cognitience-wp/releases',
        };
      } catch (err) {
        return {
          currentVersion: app.getVersion(),
          latestVersion: null,
          updateAvailable: false,
          error: err instanceof Error ? err.message : String(err),
          releaseUrl: 'https://github.com/wailonbrowngh/cognitience-wp/releases',
        };
      }
    });

    ipcMain.handle('updates:downloadAndInstall', async (_, url: string) => {
      try {
        await shell.openExternal(url);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
  }

  // ─── External Plugin Host (JSON-RPC) ────────────────────

  private registerPluginHandlers() {
    ipcMain.handle('plugin:list', async () => this.pluginHost.discoverPlugins());
    ipcMain.handle('plugin:start', async (_, id: string) => this.pluginHost.startPlugin(id));
    ipcMain.handle('plugin:stop', async (_, id: string) => this.pluginHost.stopPlugin(id));
    ipcMain.handle('plugin:running', async () => this.pluginHost.getRunningPlugins());
  }

  // ─── Plugin Scaffolding ─────────────────────────────────

  private registerPluginScaffoldHandler() {
    ipcMain.handle('ext:scaffoldPlugin', async () => {
      const result = await dialog.showOpenDialog({
        title: 'Select folder for new plugin',
        properties: ['openDirectory'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      const targetDir = result.filePaths[0];
      const pluginName = path.basename(targetDir).toLowerCase().replace(/\s+/g, '-');

      // Create plugin structure
      const manifest = {
        name: pluginName,
        displayName: pluginName.charAt(0).toUpperCase() + pluginName.slice(1),
        description: 'A Cognitience WP plugin',
        version: '1.0.0',
        publisher: 'your-name',
        main: 'main.js',
        icon: 'icon.svg',
        activationEvents: ['onStartup'],
        contributes: {
          commands: [
            { id: 'hello', title: 'Hello World' },
          ],
        },
      };

      const mainJs = `// ${pluginName} — Cognitience WP Plugin
function activate(context) {
  context.commands.registerCommand('hello', () => {
    context.notifications.info('Hello from ${pluginName}!');
  });

  // Register a toolbar button with an SVG icon
  context.toolbar.registerButton('myButton', {
    label: 'My Button',
    tooltip: 'Click me!',
    icon: 'icon.svg',
    command: 'hello',
  });

  context.logger.info('${pluginName} activated');
}

function deactivate() {}

module.exports = { activate, deactivate };
`;

      const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10"/>
  <path d="M12 8v8M8 12h8"/>
</svg>
`;

      try {
        fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(manifest, null, 2), 'utf-8');
        fs.writeFileSync(path.join(targetDir, 'main.js'), mainJs, 'utf-8');
        fs.writeFileSync(path.join(targetDir, 'icon.svg'), iconSvg, 'utf-8');

        return { success: true, path: targetDir };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
  }

  // ─── Spellcheck (native Hunspell) ───────────────────────

  private registerSpellcheckHandlers() {
    // Get spelling suggestions for a misspelled word using Electron's built-in Hunspell
    ipcMain.handle('spell:check', async (_, word: string) => {
      const win = this.windowManager.getMainWindow();
      if (!win) return { correct: true, suggestions: [] };
      const session = win.webContents.session as any;
      const isMisspelled = session.spellChecker?.isMisspelled?.(word) ?? false;
      let suggestions: string[] = [];
      if (isMisspelled) {
        if (session.spellChecker && typeof session.spellChecker.getCorrectionsForMisspelling === 'function') {
          suggestions = session.spellChecker.getCorrectionsForMisspelling(word) || [];
        }
      }
      return { correct: !isMisspelled, suggestions: suggestions.slice(0, 8) };
    });

    // Add a word to the custom dictionary
    ipcMain.handle('spell:addWord', async (_, word: string) => {
      const win = this.windowManager.getMainWindow();
      if (!win) return { success: false };
      win.webContents.session.addWordToSpellCheckerDictionary(word);
      return { success: true };
    });

    // Check multiple words and return misspelled ones with positions
    ipcMain.handle('spell:checkText', async (_, text: string) => {
      const win = this.windowManager.getMainWindow();
      if (!win) return [];
      const session = win.webContents.session as any;
      const errors: Array<{ word: string; start: number; end: number; suggestions: string[] }> = [];
      const wordRegex = /[a-zA-Z]+(?:'[a-zA-Z]+)?/g;
      let match;
      while ((match = wordRegex.exec(text)) !== null) {
        const word = match[0];
        if (word.length <= 1) continue;
        if (word === word.toUpperCase() && word.length > 1) continue;
        const isMisspelled = session.spellChecker?.isMisspelled?.(word) ?? false;
        if (isMisspelled) {
          let suggestions: string[] = [];
          if (session.spellChecker && typeof session.spellChecker.getCorrectionsForMisspelling === 'function') {
            suggestions = session.spellChecker.getCorrectionsForMisspelling(word) || [];
          }
          errors.push({
            word,
            start: match.index,
            end: match.index + word.length,
            suggestions: suggestions.slice(0, 5),
          });
        }
      }
      return errors;
    });
  }
}
