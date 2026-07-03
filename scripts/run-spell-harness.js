'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const electron = require('electron');
const harness = path.join(__dirname, 'spell-electron-harness.js');

const result = spawnSync(electron, [harness], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);