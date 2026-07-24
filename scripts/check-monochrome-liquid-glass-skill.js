#!/usr/bin/env node
/** Repo entry that runs the user-skill packaging checks. */
'use strict';
const path = require('path');
const os = require('os');
const skillCheck = path.join(
  os.homedir(),
  '.grok',
  'skills',
  'monochrome-liquid-glass',
  'scripts',
  'check-skill.js'
);
require(skillCheck);
