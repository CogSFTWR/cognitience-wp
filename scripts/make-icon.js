/**
 * Build Windows .ico + Mac-ready icon.png (>=512) from static/assets/logo.png.
 * On macOS CI we only resize icon.png (ICO is Windows-only and already committed).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'static', 'assets', 'logo.png');
const buildDir = path.join(root, 'build');
const outIco = path.join(buildDir, 'icon.ico');
const outPng = path.join(buildDir, 'icon.png');
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const macSize = 1024;

function resizeWithPowerShell(srcPng, outPng, size) {
  const ps = `
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile('${srcPng.replace(/'/g, "''")}')
$bmp = New-Object System.Drawing.Bitmap ${size}, ${size}
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($src, 0, 0, ${size}, ${size})
$bmp.Save('${outPng.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $src.Dispose()
`;
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', ps],
    { stdio: 'pipe', windowsHide: true }
  );
}

function resizeWithSips(srcPng, outPng, size) {
  // Write to a temp path then move — sips sometimes leaves incomplete files in-place.
  const tmp = outPng + '.tmp.png';
  fs.copyFileSync(srcPng, tmp);
  execFileSync('sips', ['-z', String(size), String(size), tmp], { stdio: 'pipe' });
  // Force PNG format
  execFileSync('sips', ['-s', 'format', 'png', tmp, '--out', outPng], { stdio: 'pipe' });
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
}

async function main() {
  if (!fs.existsSync(src)) {
    console.error('Missing logo:', src);
    process.exit(1);
  }
  fs.mkdirSync(buildDir, { recursive: true });

  // macOS: only need a >=512 PNG for electron-builder; skip ICO.
  if (process.platform === 'darwin') {
    resizeWithSips(src, outPng, macSize);
    console.log('Wrote', outPng, '(' + fs.statSync(outPng).size + ' bytes)');
    return;
  }

  if (process.platform !== 'win32') {
    fs.copyFileSync(src, outPng);
    console.log('Wrote', outPng, '(copied source)');
    return;
  }

  const pngToIco = require('png-to-ico');
  const tmpDir = path.join(buildDir, '_icon_sizes');
  fs.mkdirSync(tmpDir, { recursive: true });
  const pngs = [];
  for (const size of icoSizes) {
    const p = path.join(tmpDir, `icon-${size}.png`);
    try {
      resizeWithPowerShell(src, p, size);
      if (fs.existsSync(p) && fs.statSync(p).size > 0) pngs.push(p);
    } catch (e) {
      console.warn('resize failed for', size, e.message || e);
    }
  }

  if (!pngs.length) {
    const buf = await pngToIco(src);
    fs.writeFileSync(outIco, buf);
  } else {
    const buf = await pngToIco(pngs);
    fs.writeFileSync(outIco, buf);
  }

  const macPng = path.join(tmpDir, `icon-${macSize}.png`);
  resizeWithPowerShell(src, macPng, macSize);
  fs.copyFileSync(macPng, outPng);

  try {
    for (const p of [...pngs, macPng]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    fs.rmdirSync(tmpDir);
  } catch {
    /* ignore */
  }

  console.log('Wrote', outIco, '(' + fs.statSync(outIco).size + ' bytes)');
  console.log('Wrote', outPng, '(' + fs.statSync(outPng).size + ' bytes)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
