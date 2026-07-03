'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');

const electron = require('electron');
const harness = path.join(__dirname, 'spell-typing-harness.js');
const scratch = process.env.GROK_SCRATCH
  || path.join(os.tmpdir(), 'grok-goal-8cbdee8c2cc6', 'implementer');

const result = spawnSync(electron, [harness], {
  stdio: 'inherit',
  env: { ...process.env, GROK_SCRATCH: scratch },
});

process.exit(result.status ?? 1);