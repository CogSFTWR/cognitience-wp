'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const electron = require('electron');
const harness = path.join(__dirname, 'spell-electron-harness.js');

const scratch = process.env.GROK_SCRATCH
  || path.join(require('os').tmpdir(), 'grok-goal-129f57e80eb5', 'implementer');

const result = spawnSync(electron, [harness], {
  stdio: 'inherit',
  env: { ...process.env, GROK_SCRATCH: scratch },
});

process.exit(result.status ?? 1);