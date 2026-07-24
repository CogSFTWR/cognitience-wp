const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', (r) =>
    logs.push('REQFAIL: ' + r.url() + ' ' + (r.failure() && r.failure().errorText))
  );

  await page.goto('http://127.0.0.1:8799/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);

  // Simulate file open via input
  const pdfPath = path.join(__dirname, 'hello.pdf');
  await page.setInputFiles('#file-open-input', pdfPath);
  await page.waitForTimeout(4000);

  const after = await page.evaluate(() => ({
    bodyPdfOpen: document.body.classList.contains('pdf-open'),
    pdfHidden: document.getElementById('pdf-viewer').classList.contains('hidden'),
    pagesHTML: (document.getElementById('pdf-pages') || {}).innerHTML?.slice(0, 400),
    canvasCount: document.querySelectorAll('#pdf-pages canvas').length,
    pageLabel: document.getElementById('pdf-page-label')?.textContent,
    status: document.getElementById('status-text')?.textContent,
  }));
  console.log('IMPORT AFTER', JSON.stringify(after, null, 2));
  console.log('LOGS:\n' + logs.join('\n'));

  // Test binary_base64 path via evaluate (client fallback)
  await page.evaluate(async () => {
    const res = await fetch('/api/files/raw?path=hello.pdf');
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    // Access through file-open simulation isn't available; fire custom path by
    // reusing internal flow via synthetic import response handling if possible.
    window.__b64 = btoa(binary);
  });

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
