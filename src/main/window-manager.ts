/**
 * Cognitience WP — Window Manager
 * Manages BrowserWindow lifecycle, state restoration, and multi-window support.
 */

import { BrowserWindow, shell, nativeImage, screen, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigStore } from './config-store';
import { ExtensionHost } from './extension-host';

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
  isFullScreen: boolean;
}

export class WindowManager {
  private windows = new Map<number, BrowserWindow>();
  private windowState: WindowState | null = null;

  constructor(
    private configStore: ConfigStore,
    private extensionHost: ExtensionHost,
  ) {}

  createMainWindow(): BrowserWindow {
    const iconPath = path.join(__dirname, '..', '..', 'resources', 'icon.png');
    const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;

    this.windowState = this.loadWindowState();

    const window = new BrowserWindow({
      width: this.windowState?.width ?? 1280,
      height: this.windowState?.height ?? 800,
      x: this.windowState?.x,
      y: this.windowState?.y,
      minWidth: 600,
      minHeight: 400,
      show: false,
      icon,
      title: 'Cognitience WP',
      backgroundColor: '#ffffff',
      titleBarStyle: 'hidden',
      frame: false,
      trafficLightPosition: { x: 10, y: 10 },
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: true,
        additionalArguments: [
          `--cognitience-version=${app.getVersion()}`,
          `--cognitience-platform=${process.platform}`,
        ],
      },
    });

    // Load renderer
    const htmlPath = path.join(__dirname, '..', 'renderer', 'index.html');
    window.loadFile(htmlPath);

    window.once('ready-to-show', () => {
      window.show();
      if (this.windowState?.isMaximized) {
        window.maximize();
      }
      if (this.windowState?.isFullScreen) {
        window.setFullScreen(true);
      }
    });

    // Track window state
    this.trackWindowState(window);

    // Store window reference
    this.windows.set(window.id, window);
    window.on('closed', () => {
      this.windows.delete(window.id);
    });

    return window;
  }

  private loadWindowState(): WindowState | null {
    if (!this.configStore.get('window.restoreState')) return null;
    const saved = this.configStore.get('window.state') as WindowState | null;
    if (!saved) return null;

    // Verify the window position is within a display's bounds
    const displays = screen.getAllDisplays();
    const isVisible = displays.some(display => {
      const { x, y, width, height } = display.bounds;
      return saved.x >= x && saved.x + saved.width <= x + width &&
             saved.y >= y && saved.y + saved.height <= y + height;
    });

    return isVisible ? saved : null;
  }

  private trackWindowState(window: BrowserWindow) {
    const saveState = () => {
      const bounds = window.getBounds();
      this.configStore.set('window.state', {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized: window.isMaximized(),
        isFullScreen: window.isFullScreen(),
      });
    };

    window.on('resize', saveState);
    window.on('move', saveState);
    window.on('maximize', saveState);
    window.on('unmaximize', saveState);
    window.on('close', saveState);
  }

  getMainWindow(): BrowserWindow | null {
    const windows = BrowserWindow.getAllWindows();
    return windows[0] ?? null;
  }

  openFile(filePath: string) {
    const window = this.getMainWindow();
    if (window) {
      window.webContents.send('file:open', filePath);
    }
  }

  send(channel: string, ...args: unknown[]) {
    const window = this.getMainWindow();
    if (window) {
      window.webContents.send(channel, ...args);
    }
  }
}
