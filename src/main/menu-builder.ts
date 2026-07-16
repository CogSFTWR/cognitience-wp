/**
 * Cognitience WP — Menu Builder
 * Constructs the application menu (File, Edit, View, Insert, Format, Tools, Extensions, Help).
 */

import { Menu, MenuItem, BrowserWindow, dialog, app, shell, clipboard } from 'electron';
import * as path from 'path';
import { WindowManager } from './window-manager';
import { ExtensionHost } from './extension-host';
import { ConfigStore } from './config-store';
import { APP_PUBLISHER, GITHUB_RELEASES_URL } from '../shared/constants';

export class MenuBuilder {
  constructor(
    private windowManager: WindowManager,
    private extensionHost: ExtensionHost,
    private configStore: ConfigStore,
  ) {}

  buildMenu(): Menu {
    const template: Electron.MenuItemConstructorOptions[] = [
      // ─── File Menu ────────────────────────────────────
      {
        label: '&File',
        submenu: [
          {
            label: 'New Document',
            accelerator: 'CmdOrCtrl+N',
            click: () => this.windowManager.send('doc:new'),
          },
          {
            label: 'Open…',
            accelerator: 'CmdOrCtrl+O',
            click: async () => {
              this.windowManager.send('doc:open');
            },
          },
          { type: 'separator' },
          {
            label: 'Save',
            accelerator: 'CmdOrCtrl+S',
            click: () => this.windowManager.send('doc:save'),
          },
          {
            label: 'Save As…',
            accelerator: 'CmdOrCtrl+Shift+S',
            click: () => this.windowManager.send('doc:saveAs'),
          },
          { type: 'separator' },
          {
            label: 'Export as…',
            submenu: [
              {
                label: 'Markdown (.md)',
                click: () => this.windowManager.send('doc:export', { format: 'markdown' }),
              },
              {
                label: 'HTML (.html)',
                click: () => this.windowManager.send('doc:export', { format: 'html' }),
              },
              {
                label: 'PDF (.pdf)',
                click: () => this.windowManager.send('doc:export', { format: 'pdf' }),
              },
              {
                label: 'Word Document (.docx)',
                click: () => this.windowManager.send('doc:export', { format: 'docx' }),
              },
              {
                label: 'Word 97-2003 (.doc)',
                click: () => this.windowManager.send('doc:export', { format: 'doc' }),
              },
              {
                label: 'Plain Text (.txt)',
                click: () => this.windowManager.send('doc:export', { format: 'plaintext' }),
              },
              {
                label: 'Cognitience Document (.cog)',
                click: () => this.windowManager.send('doc:export', { format: 'cog' }),
              },
            ],
          },
          { type: 'separator' },
          {
            label: 'Page Setup…',
            click: () => this.windowManager.send('doc:pageSetup'),
          },
          {
            label: 'Print…',
            accelerator: 'CmdOrCtrl+P',
            click: () => this.windowManager.send('doc:print'),
          },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },

      // ─── Edit Menu ────────────────────────────────────
      {
        label: '&Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
          { type: 'separator' },
          {
            label: 'Find',
            accelerator: 'CmdOrCtrl+F',
            click: () => this.windowManager.send('editor:find'),
          },
          {
            label: 'Replace',
            accelerator: 'CmdOrCtrl+H',
            click: () => this.windowManager.send('editor:replace'),
          },
          { type: 'separator' },
          {
            label: 'Find Next',
            accelerator: 'F3',
            click: () => this.windowManager.send('editor:findNext'),
          },
          {
            label: 'Find Previous',
            accelerator: 'Shift+F3',
            click: () => this.windowManager.send('editor:findPrev'),
          },
        ],
      },

      // ─── View Menu ────────────────────────────────────
      {
        label: '&View',
        submenu: [
          {
            label: 'Toggle Sidebar',
            accelerator: 'CmdOrCtrl+Shift+B',
            click: () => this.windowManager.send('view:toggleSidebar'),
          },
          {
            label: 'Toggle Outline',
            accelerator: 'CmdOrCtrl+Shift+O',
            click: () => this.windowManager.send('view:toggleOutline'),
          },
          {
            label: 'Toggle Focus Mode',
            accelerator: 'CmdOrCtrl+Shift+F',
            click: () => this.windowManager.send('view:toggleFocusMode'),
          },
          {
            label: 'Toggle Full Screen',
            accelerator: 'F11',
            click: () => this.windowManager.send('view:toggleFullscreen'),
          },
          { type: 'separator' },
          {
            label: 'Zoom In',
            accelerator: 'CmdOrCtrl+=',
            click: () => this.windowManager.send('view:zoomIn'),
          },
          {
            label: 'Zoom Out',
            accelerator: 'CmdOrCtrl+-',
            click: () => this.windowManager.send('view:zoomOut'),
          },
          {
            label: 'Reset Zoom',
            accelerator: 'CmdOrCtrl+0',
            click: () => this.windowManager.send('view:zoomReset'),
          },
          { type: 'separator' },
          {
            label: 'Command Palette…',
            accelerator: 'CmdOrCtrl+Shift+P',
            click: () => this.windowManager.send('view:commandPalette'),
          },
          { type: 'separator' },
          {
            label: 'Switch Theme',
            submenu: this.buildThemeMenu(),
          },
        ],
      },

      // ─── Insert Menu ──────────────────────────────────
      {
        label: '&Insert',
        submenu: [
          {
            label: 'Heading 1',
            accelerator: 'CmdOrCtrl+1',
            click: () => this.windowManager.send('insert:heading', { level: 1 }),
          },
          {
            label: 'Heading 2',
            accelerator: 'CmdOrCtrl+2',
            click: () => this.windowManager.send('insert:heading', { level: 2 }),
          },
          {
            label: 'Heading 3',
            accelerator: 'CmdOrCtrl+3',
            click: () => this.windowManager.send('insert:heading', { level: 3 }),
          },
          { type: 'separator' },
          {
            label: 'Bold',
            accelerator: 'CmdOrCtrl+B',
            click: () => this.windowManager.send('insert:bold'),
          },
          {
            label: 'Italic',
            accelerator: 'CmdOrCtrl+I',
            click: () => this.windowManager.send('insert:italic'),
          },
          {
            label: 'Underline',
            accelerator: 'CmdOrCtrl+U',
            click: () => this.windowManager.send('insert:underline'),
          },
          {
            label: 'Strikethrough',
            click: () => this.windowManager.send('insert:strikethrough'),
          },
          { type: 'separator' },
          {
            label: 'Link',
            accelerator: 'CmdOrCtrl+K',
            click: () => this.windowManager.send('insert:link'),
          },
          {
            label: 'Image',
            click: () => this.windowManager.send('insert:image'),
          },
          {
            label: 'Table',
            click: () => this.windowManager.send('insert:table'),
          },
          { type: 'separator' },
          {
            label: 'Code Block',
            accelerator: 'CmdOrCtrl+Shift+C',
            click: () => this.windowManager.send('insert:codeBlock'),
          },
          {
            label: 'Quote Block',
            accelerator: 'CmdOrCtrl+Shift+Q',
            click: () => this.windowManager.send('insert:quote'),
          },
          {
            label: 'Horizontal Rule',
            accelerator: 'CmdOrCtrl+Shift+H',
            click: () => this.windowManager.send('insert:hr'),
          },
          { type: 'separator' },
          {
            label: 'Bullet List',
            click: () => this.windowManager.send('insert:list', { type: 'bullet' }),
          },
          {
            label: 'Numbered List',
            click: () => this.windowManager.send('insert:list', { type: 'numbered' }),
          },
          {
            label: 'Checklist',
            click: () => this.windowManager.send('insert:list', { type: 'checklist' }),
          },
          { type: 'separator' },
          {
            label: 'Templates',
            submenu: [
              {
                label: 'arXiv Research Paper',
                click: () => this.windowManager.send('insert:template', { template: 'arxiv' }),
              },
              {
                label: 'Outline',
                click: () => this.windowManager.send('insert:template', { template: 'outline' }),
              },
              {
                label: 'Email',
                click: () => this.windowManager.send('insert:template', { template: 'email' }),
              },
              {
                label: 'Book Manuscript',
                click: () => this.windowManager.send('insert:template', { template: 'book' }),
              },
              {
                label: 'Blank Document',
                click: () => this.windowManager.send('insert:template', { template: 'blank' }),
              },
            ],
          },
        ],
      },

      // ─── Format Menu ──────────────────────────────────
      {
        label: 'F&ormat',
        submenu: [
          {
            label: 'Align Left',
            click: () => this.windowManager.send('format:align', { align: 'left' }),
          },
          {
            label: 'Align Center',
            click: () => this.windowManager.send('format:align', { align: 'center' }),
          },
          {
            label: 'Align Right',
            click: () => this.windowManager.send('format:align', { align: 'right' }),
          },
          {
            label: 'Justify',
            click: () => this.windowManager.send('format:align', { align: 'justify' }),
          },
          { type: 'separator' },
          {
            label: 'Increase Font Size',
            click: () => this.windowManager.send('format:fontSize', { delta: 1 }),
          },
          {
            label: 'Decrease Font Size',
            click: () => this.windowManager.send('format:fontSize', { delta: -1 }),
          },
          { type: 'separator' },
          {
            label: 'Subscript',
            click: () => this.windowManager.send('format:subscript'),
          },
          {
            label: 'Superscript',
            click: () => this.windowManager.send('format:superscript'),
          },
          {
            label: 'Highlight',
            click: () => this.windowManager.send('format:highlight'),
          },
          { type: 'separator' },
          {
            label: 'Clear Formatting',
            accelerator: 'CmdOrCtrl+\\',
            click: () => this.windowManager.send('format:clear'),
          },
        ],
      },

      // ─── Tools Menu ──────────────────────────────────
      {
        label: '&Tools',
        submenu: [
          {
            label: 'Word Count',
            accelerator: 'CmdOrCtrl+Shift+W',
            click: () => this.windowManager.send('tools:wordCount'),
          },
          {
            label: 'Spell Check',
            type: 'checkbox',
            checked: this.configStore.get('editor.spellcheck') as boolean,
            click: (menuItem) => {
              this.configStore.set('editor.spellcheck', menuItem.checked);
              this.windowManager.send('config:changed', { key: 'editor.spellcheck', value: menuItem.checked });
            },
          },
          {
            label: 'Auto Save',
            type: 'checkbox',
            checked: this.configStore.get('editor.autoSave') as boolean,
            click: (menuItem) => {
              this.configStore.set('editor.autoSave', menuItem.checked);
              this.windowManager.send('config:changed', { key: 'editor.autoSave', value: menuItem.checked });
            },
          },
          { type: 'separator' },
          {
            label: 'Settings…',
            accelerator: 'CmdOrCtrl+,',
            click: () => this.windowManager.send('tools:settings'),
          },
        ],
      },

      // ─── Extensions Menu ───────────────────────────────
      {
        label: '&Extensions',
        submenu: [
          {
            label: 'Install from .cogwp…',
            click: async () => {
              const result = await dialog.showOpenDialog({
                title: 'Install Extension',
                filters: [
                  { name: 'Cognitience Plugin', extensions: ['cogwp', 'zip'] },
                  { name: 'All Files', extensions: ['*'] },
                ],
                properties: ['openFile'],
              });
              if (!result.canceled && result.filePaths.length > 0) {
                this.windowManager.send('ext:installRequest', result.filePaths[0]);
              }
            },
          },
          {
            label: 'Browse Extensions…',
            click: () => this.windowManager.send('ext:browse'),
          },
          { type: 'separator' },
          {
            label: 'Installed Extensions',
            click: () => this.windowManager.send('ext:manage'),
          },
          {
            label: 'Reload All Extensions',
            click: () => this.windowManager.send('ext:reloadAll'),
          },
          { type: 'separator' },
          {
            label: 'Developer: Create New Extension',
            click: () => this.windowManager.send('ext:createNew'),
          },
        ],
      },

      // ─── Window Menu ────────────────────────────────────
      {
        label: '&Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          {
            label: 'New Window',
            accelerator: 'CmdOrCtrl+Shift+N',
            click: () => this.windowManager.createMainWindow(),
          },
        ],
      },

      // ─── Help Menu ─────────────────────────────────────
      {
        label: '&Help',
        submenu: [
          {
            label: 'Documentation',
            click: () => shell.openExternal('https://github.com/Maq-Swarm/cognitience-wp#readme'),
          },
          {
            label: 'Extension API Reference',
            click: () => shell.openExternal('https://github.com/Maq-Swarm/cognitience-wp/tree/main/docs'),
          },
          {
            label: 'Keyboard Shortcuts',
            accelerator: 'CmdOrCtrl+/',
            click: () => this.windowManager.send('help:shortcuts'),
          },
          { type: 'separator' },
          {
            label: 'Report Issue',
            click: () => shell.openExternal('https://github.com/Maq-Swarm/cognitience-wp/issues'),
          },
          {
            label: 'Check for Updates',
            click: () => this.windowManager.send('help:checkUpdates'),
          },
          { type: 'separator' },
          {
            label: 'Developer: Create New Plugin',
            click: () => this.windowManager.send('ext:createNew'),
          },
          {
            label: 'Developer: Plugin Documentation',
            click: () => this.windowManager.send('ext:docs'),
          },
          { type: 'separator' },
          {
            label: 'About Cognitience WP',
            click: () => {
              const win = this.windowManager.getMainWindow();
              if (win) {
                dialog.showMessageBox(win, {
                  type: 'info',
                  title: 'About Cognitience WP',
                  message: 'Cognitience WP',
                  detail: 'The VS Code of word processors.\n\nVersion: ' + app.getVersion() + '\nPublisher: ' + APP_PUBLISHER + '\nLicense: MIT\nElectron: ' + process.versions.electron + '\nNode: ' + process.versions.node + '\nV8: ' + process.versions.v8,
                  icon: undefined,
                });
              }
            },
          },
        ],
      },
    ];

    return Menu.buildFromTemplate(template);
  }

  private buildThemeMenu(): Electron.MenuItemConstructorOptions[] {
    const themes = [
      { id: 'cognitience-dark', label: 'Cognitience Dark' },
      { id: 'cognitience-light', label: 'Cognitience Light' },
      { id: 'cognitience-sepia', label: 'Cognitience Sepia' },
      { id: 'cognitience-contrast-dark', label: 'High Contrast Dark' },
    ];

    const currentTheme = this.configStore.get('theme.current') as string;

    return themes.map(theme => ({
      label: theme.label,
      type: 'radio' as const,
      checked: theme.id === currentTheme,
      click: () => {
        this.configStore.set('theme.current', theme.id);
        this.windowManager.send('theme:changed', theme.id);
      },
    }));
  }
}
