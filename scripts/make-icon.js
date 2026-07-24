/**
 * Build Windows .ico (and png sizes) from static/assets/logo.png for Electron.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'static', 'assets', 'logo.png');
const buildDir = path.join(root, 'build');
const outIco = path.join(buildDir, 'icon.ico');
const outPng = path.join(buildDir, 'icon.png');

async function main() {
  if (!fs.existsSync(src)) {
    console.error('Missing logo:', src);
    process.exit(1);
  }
  fs.mkdirSync(buildDir, { recursive: true });
  // png-to-ico accepts PNG path(s); multi-size ICO for Windows taskbar/desktop
  const buf = await pngToIco(src);
  fs.writeFileSync(outIco, buf);
  fs.copyFileSync(src, outPng);
  console.log('Wrote', outIco, '(' + buf.length + ' bytes)');
  console.log('Wrote', outPng);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
