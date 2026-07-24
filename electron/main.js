/**
 * Cognitience WP — Electron shell.
 * Spawns the local Rust backend and loads the UI from localhost.
 */
'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

// Must match package.json build.appId — Windows taskbar pin uses this identity.
// Without it, pinned shortcuts fall back to the default Electron icon/AUMID.
const APP_USER_MODEL_ID = 'com.cognitience.wp';
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

const PORT = Number(process.env.PORT) || 8787;
let mainWindow = null;
let backendProc = null;

function isPackaged() {
  return app.isPackaged;
}

function backendBinary() {
  if (isPackaged()) {
    return path.join(process.resourcesPath, 'backend', 'cognition-wp.exe');
  }
  // Prefer release, fall back to debug for local electron runs
  const release = path.join(__dirname, '..', 'target', 'release', 'cognition-wp.exe');
  const debug = path.join(__dirname, '..', 'target', 'debug', 'cognition-wp.exe');
  if (fs.existsSync(release)) return release;
  return debug;
}

function staticDir() {
  if (isPackaged()) {
    return path.join(process.resourcesPath, 'static');
  }
  return path.join(__dirname, '..', 'static');
}

function dataDir() {
  return path.join(app.getPath('userData'), 'cognition-data');
}

function waitForHealth(port, attempts = 60) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      n += 1;
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else if (n >= attempts) reject(new Error('Backend health check failed'));
        else setTimeout(tick, 200);
      });
      req.on('error', () => {
        if (n >= attempts) reject(new Error('Backend did not start in time'));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}

function startBackend() {
  const bin = backendBinary();
  if (!fs.existsSync(bin)) {
    throw new Error(`Backend binary not found: ${bin}\nRun: cargo build --release`);
  }

  fs.mkdirSync(dataDir(), { recursive: true });

  const env = {
    ...process.env,
    PORT: String(PORT),
    COGNITION_STATIC_DIR: staticDir(),
    COGNITION_DATA_DIR: dataDir(),
    RUST_LOG: process.env.RUST_LOG || 'info',
  };

  backendProc = spawn(bin, [], {
    env,
    cwd: path.dirname(bin),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProc.stdout.on('data', (d) => {
    if (process.env.COGNITION_DEBUG) process.stdout.write(`[backend] ${d}`);
  });
  backendProc.stderr.on('data', (d) => {
    if (process.env.COGNITION_DEBUG) process.stderr.write(`[backend] ${d}`);
  });
  backendProc.on('exit', (code) => {
    backendProc = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.error(`Backend exited with code ${code}`);
    }
  });

  return waitForHealth(PORT);
}

function stopBackend() {
  if (!backendProc) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(backendProc.pid), '/f', '/t'], { windowsHide: true });
    } else {
      backendProc.kill('SIGTERM');
    }
  } catch {
    /* ignore */
  }
  backendProc = null;
}

function appIconPath() {
  // Packaged: resources/build/icon.ico or next to exe; dev: build/icon.ico
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(process.resourcesPath || '', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'static', 'assets', 'logo.png'),
    path.join(process.resourcesPath || '', 'static', 'assets', 'logo.png'),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function createWindow() {
  const icon = appIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Cognitience WP',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await startBackend();
      createWindow();
    } catch (err) {
      console.error(err);
      const { dialog } = require('electron');
      dialog.showErrorBox('Cognitience WP', String(err.message || err));
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    stopBackend();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    stopBackend();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
