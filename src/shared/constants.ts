/**
 * Cognitience WP — Shared Constants
 */

import { getPackageVersion } from './version';

export const APP_NAME = 'Cognitience WP';
export const APP_VERSION = getPackageVersion();
export const APP_PUBLISHER = 'wailonbrowngh';
export const GITHUB_REPO = 'Maq-Swarm/cognitience-wp';
export const GITHUB_RELEASES_URL = 'https://github.com/Maq-Swarm/cognitience-wp/releases';
export const GITHUB_LATEST_API = 'https://api.github.com/repos/Maq-Swarm/cognitience-wp/releases/latest';

export const EXTENSIONS_DIR = 'extensions';
export const CONFIG_FILE = 'cognitience-wp-config.json';

export const DEFAULT_CONFIG: Record<string, unknown> = {
  'editor.fontSize': 12,
  'editor.fontFamily': "'Segoe UI', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
  'editor.lineHeight': 1.6,
  'editor.tabSize': 4,
  'editor.wordWrap': true,
  'editor.spellcheck': true,
  'editor.customDictionary': [],
  'editor.autoSave': false,
  'editor.autoSaveDelay': 1000,
  'editor.showLineNumbers': false,
  'editor.minimap': false,
  'editor.rulers': [],
  'editor.highlightActiveLine': true,
  'editor.smoothScrolling': true,
  'editor.cursorStyle': 'line',
  'editor.cursorBlink': 'blink',
  'editor.padding': 40,
  'editor.paragraphSpacing': 16,
  'editor.maxLineWidth': 720,

  'theme.current': 'cognitience-light',
  'theme.autoDetect': true,

  'window.titleBarStyle': 'custom',
  'window.zoomLevel': 0,
  'window.restoreState': true,

  'files.autoSave': 'off',
  'files.hotExit': true,
  'files.defaultFormat': 'cognitience',
  'files.exclude': ['**/.git', '**/.DS_Store'],

  'telemetry.enable': false,
  'telemetry.crashReporting': false,

  'extensions.autoUpdate': true,
  'extensions.ignoreRecommendations': false,
  'extensions.allowUntrusted': false,
  'extensions.galleryEnabled': true,
  'extensions.galleryUrl': 'https://registry.cognitiencewp.org/api',

  'updates.autoCheck': true,
  'updates.channel': 'stable',
  'updates.lastChecked': null,
  'updates.lastVersion': null,

  'plugins.developerMode': false,
  'plugins.format': '.cogwp',
};

export const COGNITIENCE_DOC_FORMAT = {
  magic: 'COGWP',
  version: '3.0.0',
  supportedVersions: ['1.0.0', '2.0.0', '2.1.0', '3.0.0'],
  // v3.0.0: Markdown body + YAML frontmatter (human & AI readable)
  // v2.x:   JSON wrapper (legacy, still readable for backward compat)
} as const;

export const PLUGIN_FORMAT = {
  extension: '.cogwp',
  description: 'Cognitience WP Plugin Package',
  // .cogwp files are ZIP archives containing:
  //   package.json (manifest)
  //   main.js (entry point)
  //   icon.svg (toolbar icon, if applicable)
  //   additional resources
} as const;

export const BUILTIN_THEMES = [
  {
    id: 'cognitience-dark',
    label: 'Cognitience Dark',
    type: 'dark' as const,
    colors: {
      'editor.background': '#1e1e2e',
      'editor.foreground': '#cdd6f4',
      'editor.selection': '#585b70',
      'editor.cursor': '#f5e0dc',
      'editor.activeLine': '#313244',
      'sidebar.background': '#181825',
      'sidebar.foreground': '#cdd6f4',
      'statusBar.background': '#181825',
      'statusBar.foreground': '#cdd6f4',
      'titleBar.background': '#11111b',
      'titleBar.foreground': '#cdd6f4',
      'border': '#45475a',
      'accent': '#89b4fa',
      'error': '#f38ba8',
      'warning': '#fab387',
      'success': '#a6e3a1',
      'menu.background': '#1e1e2e',
      'menu.foreground': '#cdd6f4',
      'panel.background': '#181825',
      'panel.foreground': '#cdd6f4',
      'tooltip.background': '#313244',
      'tooltip.foreground': '#cdd6f4',
    },
  },
  {
    id: 'cognitience-light',
    label: 'Cognitience Light',
    type: 'light' as const,
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#1e1e2e',
      'editor.selection': '#cba6f7',
      'editor.cursor': '#1e1e2e',
      'editor.activeLine': '#f5f5f5',
      'sidebar.background': '#f7f7fa',
      'sidebar.foreground': '#1e1e2e',
      'statusBar.background': '#f7f7fa',
      'statusBar.foreground': '#1e1e2e',
      'titleBar.background': '#ececf0',
      'titleBar.foreground': '#1e1e2e',
      'border': '#d4d4d8',
      'accent': '#6c5ce7',
      'error': '#e74c3c',
      'warning': '#f39c12',
      'success': '#27ae60',
      'menu.background': '#ffffff',
      'menu.foreground': '#1e1e2e',
      'panel.background': '#f7f7fa',
      'panel.foreground': '#1e1e2e',
      'tooltip.background': '#333333',
      'tooltip.foreground': '#ffffff',
    },
  },
  {
    id: 'cognitience-sepia',
    label: 'Cognitience Sepia',
    type: 'light' as const,
    colors: {
      'editor.background': '#f4ecd8',
      'editor.foreground': '#5b4636',
      'editor.selection': '#d4c4a8',
      'editor.cursor': '#5b4636',
      'editor.activeLine': '#ede0c8',
      'sidebar.background': '#e8dfc8',
      'sidebar.foreground': '#5b4636',
      'statusBar.background': '#e8dfc8',
      'statusBar.foreground': '#5b4636',
      'titleBar.background': '#ddd0b8',
      'titleBar.foreground': '#5b4636',
      'border': '#c4b495',
      'accent': '#a0522d',
      'error': '#cd5c5c',
      'warning': '#daa520',
      'success': '#6b8e23',
      'menu.background': '#f4ecd8',
      'menu.foreground': '#5b4636',
      'panel.background': '#e8dfc8',
      'panel.foreground': '#5b4636',
      'tooltip.background': '#5b4636',
      'tooltip.foreground': '#f4ecd8',
    },
  },
  {
    id: 'cognitience-contrast-dark',
    label: 'Cognitience High Contrast (Dark)',
    type: 'contrast' as const,
    colors: {
      'editor.background': '#000000',
      'editor.foreground': '#ffffff',
      'editor.selection': '#264f78',
      'editor.cursor': '#ffffff',
      'editor.activeLine': '#1a1a1a',
      'sidebar.background': '#000000',
      'sidebar.foreground': '#ffffff',
      'statusBar.background': '#000000',
      'statusBar.foreground': '#ffffff',
      'titleBar.background': '#000000',
      'titleBar.foreground': '#ffffff',
      'border': '#ffffff',
      'accent': '#ffff00',
      'error': '#ff0000',
      'warning': '#ffff00',
      'success': '#00ff00',
      'menu.background': '#000000',
      'menu.foreground': '#ffffff',
      'panel.background': '#000000',
      'panel.foreground': '#ffffff',
      'tooltip.background': '#000000',
      'tooltip.foreground': '#ffffff',
    },
  },
];
