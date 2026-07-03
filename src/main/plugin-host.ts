/**
 * Cognitience WP — Plugin Compatibility Layer
 * Enables external tools (like Claude Code, Codex, etc.) to plug into Cognitience WP
 * via a standardized protocol — similar to how language servers plug into VS Code.
 *
 * Protocol: JSON-RPC 2.0 over stdio
 * Tools communicate with Cognitience WP via a simple protocol:
 *   1. Tool launches as a child process
 *   2. Tool sends "initialize" request
 *   3. Cognitience WP responds with capabilities
 *   4. Tool can then send commands (editor.getContent, editor.setContent, etc.)
 */

import { ChildProcess, spawn } from 'child_process';
import { app, ipcMain, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';

export interface PluginDescriptor {
  id: string;
  name: string;
  version: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  capabilities: string[];
}

interface PluginInstance {
  descriptor: PluginDescriptor;
  process: ChildProcess | null;
  initialized: boolean;
  requestId: number;
  pendingRequests: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
}

export class PluginHost extends EventEmitter {
  private plugins = new Map<string, PluginInstance>();
  private pluginsDir: string;

  constructor() {
    super();
    this.pluginsDir = path.join(app.getPath('userData'), 'plugins');
    this.ensurePluginsDir();
  }

  private ensurePluginsDir() {
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
    }
  }

  // ─── Plugin Discovery ──────────────────────────────────────

  discoverPlugins(): PluginDescriptor[] {
    const plugins: PluginDescriptor[] = [];
    if (!fs.existsSync(this.pluginsDir)) return plugins;

    const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(this.pluginsDir, entry.name, 'plugin.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        plugins.push({
          id: manifest.id || entry.name,
          name: manifest.name || entry.name,
          version: manifest.version || '1.0.0',
          command: manifest.command,
          args: manifest.args || [],
          cwd: path.join(this.pluginsDir, entry.name),
          env: manifest.env || {},
          capabilities: manifest.capabilities || [],
        });
      } catch (err) {
        console.error(`[PluginHost] Failed to load plugin ${entry.name}:`, err);
      }
    }
    return plugins;
  }

  // ─── Plugin Lifecycle ───────────────────────────────────────

  async startPlugin(pluginId: string): Promise<boolean> {
    const descriptors = this.discoverPlugins();
    const desc = descriptors.find(d => d.id === pluginId);
    if (!desc) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (this.plugins.has(pluginId)) {
      console.log(`[PluginHost] Plugin already running: ${pluginId}`);
      return true;
    }

    const instance: PluginInstance = {
      descriptor: desc,
      process: null,
      initialized: false,
      requestId: 1,
      pendingRequests: new Map(),
    };

    // Spawn the plugin process
    const proc = spawn(desc.command, desc.args, {
      cwd: desc.cwd,
      env: { ...process.env, ...desc.env, COGNITIENCE_WP_PLUGIN: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    instance.process = proc;

    // Handle stdout (JSON-RPC responses)
    let buffer = '';
    proc.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      // Process complete JSON-RPC messages (newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) {
          this.handleMessage(instance, line.trim());
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      console.error(`[PluginHost:${pluginId}] stderr:`, data.toString());
    });

    proc.on('error', (err) => {
      console.error(`[PluginHost:${pluginId}] Process error:`, err);
      this.plugins.delete(pluginId);
    });

    proc.on('exit', (code) => {
      console.log(`[PluginHost:${pluginId}] Exited with code ${code}`);
      this.plugins.delete(pluginId);
      this.emit('plugin:stopped', pluginId);
    });

    this.plugins.set(pluginId, instance);

    // Send initialize request
    try {
      await this.sendRequest(instance, 'initialize', {
        processId: process.pid,
        appVersion: app.getVersion(),
        rootUri: `file://${app.getPath('userData')}`,
        capabilities: {
          editor: true,
          documents: true,
          commands: true,
          statusBar: true,
          notifications: true,
          configuration: true,
        },
      });
      instance.initialized = true;
      this.emit('plugin:started', pluginId);
      console.log(`[PluginHost] Plugin started: ${pluginId}`);
      return true;
    } catch (err) {
      console.error(`[PluginHost] Failed to initialize plugin ${pluginId}:`, err);
      this.stopPlugin(pluginId);
      return false;
    }
  }

  stopPlugin(pluginId: string) {
    const instance = this.plugins.get(pluginId);
    if (!instance || !instance.process) return;
    try {
      this.sendNotification(instance, 'shutdown', {});
      instance.process.kill('SIGTERM');
    } catch (err) {
      console.error(`[PluginHost] Error stopping plugin ${pluginId}:`, err);
      try { instance.process.kill('SIGKILL'); } catch {}
    }
    this.plugins.delete(pluginId);
  }

  stopAllPlugins() {
    for (const id of this.plugins.keys()) {
      this.stopPlugin(id);
    }
  }

  // ─── JSON-RPC Protocol ─────────────────────────────────────

  private handleMessage(instance: PluginInstance, raw: string) {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch (err) {
      console.error('[PluginHost] Invalid JSON:', raw);
      return;
    }

    const msg = message as Record<string, unknown>;
    // Response to our request
    if ('id' in msg && ('result' in msg || 'error' in msg)) {
      const pending = instance.pendingRequests.get(msg.id as number);
      if (pending) {
        if (msg.error) {
          pending.reject(new Error(msg.error as string));
        } else {
          pending.resolve(msg.result);
        }
        instance.pendingRequests.delete(msg.id as number);
      }
      return;
    }

    // Request from plugin
    if ('method' in msg) {
      this.handlePluginRequest(instance, msg);
    }
  }

  private async handlePluginRequest(instance: PluginInstance, msg: Record<string, unknown>) {
    const method = msg.method as string;
    const params = (msg.params || {}) as Record<string, unknown>;
    const id = msg.id as number | undefined;

    let result: unknown = null;
    let error: string | null = null;

    try {
      switch (method) {
        case 'editor.getContent':
          result = await this.invokeRenderer('editor:getContent');
          break;
        case 'editor.setContent':
          this.notifyRenderer('editor:setContent', params.content);
          result = true;
          break;
        case 'editor.getSelection':
          result = await this.invokeRenderer('editor:getSelection');
          break;
        case 'editor.insertText':
          this.notifyRenderer('editor:insertText', params);
          result = true;
          break;
        case 'editor.replaceSelection':
          this.notifyRenderer('editor:replaceSelection', params.text);
          result = true;
          break;
        case 'notifications.info':
          this.notifyRenderer('notification:info', params.message);
          result = true;
          break;
        case 'notifications.warning':
          this.notifyRenderer('notification:warning', params.message);
          break;
        case 'notifications.error':
          this.notifyRenderer('notification:error', params.message);
          result = true;
          break;
        case 'statusBar.create':
          this.notifyRenderer('statusBar:create', params);
          result = { id: `plugin-${Date.now()}` };
          break;
        case 'statusBar.update':
          this.notifyRenderer('statusBar:update', params);
          result = true;
          break;
        case 'commands.register':
          result = true;
          break;
        case 'commands.execute':
          result = true;
          break;
        default:
          error = `Unknown method: ${method}`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    // Send response if this was a request
    if (id !== undefined) {
      this.sendResponse(instance, id, result, error);
    }
  }

  private sendRequest(instance: PluginInstance, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = instance.requestId++;
      instance.pendingRequests.set(id, { resolve, reject });

      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      instance.process?.stdin?.write(message);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (instance.pendingRequests.has(id)) {
          instance.pendingRequests.delete(id);
          reject(new Error(`Request timed out: ${method}`));
        }
      }, 30000);
    });
  }

  private sendNotification(instance: PluginInstance, method: string, params: unknown) {
    const message = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    instance.process?.stdin?.write(message);
  }

  private sendResponse(instance: PluginInstance, id: number, result: unknown, error: string | null) {
    const msg: Record<string, unknown> = { jsonrpc: '2.0', id };
    if (error) {
      msg.error = { code: -32603, message: error };
    } else {
      msg.result = result;
    }
    instance.process?.stdin?.write(JSON.stringify(msg) + '\n');
  }

  // ─── Renderer Communication ─────────────────────────────────

  private notifyRenderer(channel: string, ...args: unknown[]) {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, ...args);
    }
  }

  private invokeRenderer<T>(channel: string): Promise<T> {
    return new Promise((resolve) => {
      const wins = BrowserWindow.getAllWindows();
      if (wins.length === 0) { resolve(null as T); return; }
      ipcMain.handleOnce(`${channel}:result`, (_, result: T) => { resolve(result); return null; });
      wins[0].webContents.send(channel);
    });
  }

  getRunningPlugins(): string[] {
    return Array.from(this.plugins.keys());
  }
}
