/**
 * Smoke test: spawn electron . (real entry) and assert no ERR_REQUIRE_ESM within startup window.
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SCRATCH = process.env.GROK_SCRATCH
  || path.join(os.tmpdir(), 'grok-goal-8cbdee8c2cc6', 'implementer');
const LOG_PATH = path.join(SCRATCH, `launch-smoke-${Date.now()}.log`);

fs.mkdirSync(SCRATCH, { recursive: true });

const electron = require('electron');
const lines = [];

function log(msg) {
  const line = typeof msg === 'string' ? msg : JSON.stringify(msg);
  lines.push(line);
  console.log(line);
}

const child = spawn(electron, ['.'], {
  cwd: ROOT,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => { stdout += d.toString(); });
child.stderr.on('data', (d) => { stderr += d.toString(); });

const timeoutMs = 12000;
const timer = setTimeout(() => {
  child.kill();
}, timeoutMs);

child.on('close', (code) => {
  clearTimeout(timer);
  log('=== Launch smoke (electron .) ===');
  log(`exit code: ${code}`);
  if (stdout.trim()) log(`stdout:\n${stdout.trim()}`);
  if (stderr.trim()) log(`stderr:\n${stderr.trim()}`);

  const combined = stdout + stderr;
  if (combined.includes('ERR_REQUIRE_ESM')) {
    log('FAILED: ERR_REQUIRE_ESM detected');
    fs.writeFileSync(LOG_PATH, lines.join('\n') + '\n', 'utf-8');
    process.exit(1);
  }
  if (combined.includes('App threw an error during load')) {
    log('FAILED: App threw an error during load');
    fs.writeFileSync(LOG_PATH, lines.join('\n') + '\n', 'utf-8');
    process.exit(1);
  }
  log('LAUNCH SMOKE PASSED (no ERR_REQUIRE_ESM / load crash in startup window)');
  fs.writeFileSync(LOG_PATH, lines.join('\n') + '\n', 'utf-8');
  log(`wrote ${LOG_PATH}`);
  process.exit(0);
});