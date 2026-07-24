/**
 * End-to-end PDF open tests against the real backend + (optional) Playwright UI.
 *
 * Env:
 *   PDF_TEST_PORT      default 8799
 *   PDF_TEST_BASE      default http://127.0.0.1:$PORT
 *   SKIP_UI            set to 1 to skip Playwright
 *   SCRATCH_DIR        where to write logs (optional)
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PORT = Number(process.env.PDF_TEST_PORT || process.env.PORT || 8799);
const BASE = process.env.PDF_TEST_BASE || `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(ROOT, 'testdocs', 'sample-multipage.pdf');
const HELLO = path.join(ROOT, 'testdocs', 'hello.pdf');
const SCRATCH =
  process.env.SCRATCH_DIR ||
  path.join(ROOT, 'testdocs');

function request(method, urlPath, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, BASE);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: headers || {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function logLines(name, lines) {
  const file = path.join(SCRATCH, name);
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  console.log('wrote', file);
}

async function testApi() {
  assert.ok(fs.existsSync(FIXTURE), 'missing fixture ' + FIXTURE);
  const fixtureBytes = fs.readFileSync(FIXTURE);
  assert.ok(fixtureBytes.length > 2000, 'fixture multi-KB');
  assert.strictEqual(fixtureBytes.slice(0, 4).toString(), '%PDF');

  // Health (boot proof)
  const health1 = await request('GET', '/api/health');
  assert.strictEqual(health1.status, 200, 'health1');
  const health2 = await request('GET', '/api/health');
  assert.strictEqual(health2.status, 200, 'health2');
  const healthJson = JSON.parse(health1.body.toString());
  assert.strictEqual(healthJson.ok, true);

  // Open multipage PDF
  const open = await request('POST', '/api/files/open', {
    body: JSON.stringify({ path: 'sample-multipage.pdf' }),
    headers: { 'Content-Type': 'application/json' },
  });
  assert.strictEqual(open.status, 200, 'open status ' + open.status + ' ' + open.body.toString());
  const opened = JSON.parse(open.body.toString());
  assert.strictEqual(opened.format, 'pdf');
  assert.strictEqual(opened.binary, true);
  assert.ok(opened.view_url, 'view_url required');
  assert.ok(!opened.binary_base64, 'disk open must not use base64');
  assert.strictEqual(opened.html, '');
  assert.ok(
    (opened.mime || '').includes('pdf'),
    'mime ' + opened.mime
  );

  // Raw bytes
  const raw = await request('GET', opened.view_url);
  assert.strictEqual(raw.status, 200, 'raw status');
  const ct = String(raw.headers['content-type'] || '');
  assert.ok(ct.includes('pdf'), 'content-type ' + ct);
  assert.strictEqual(raw.body.slice(0, 4).toString(), '%PDF');
  assert.ok(raw.body.length >= fixtureBytes.length * 0.9, 'raw size');

  // Import path — must return view_url, not multi-MB base64 dependency
  const boundary = '----CognitionPdfTestBoundary';
  const hello = fs.readFileSync(HELLO);
  const multipart = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="import-hello.pdf"\r\nContent-Type: application/pdf\r\n\r\n`
    ),
    hello,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const imp = await request('POST', '/api/files/import', {
    body: multipart,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': multipart.length,
    },
  });
  assert.strictEqual(imp.status, 200, 'import ' + imp.body.toString().slice(0, 200));
  const imported = JSON.parse(imp.body.toString());
  assert.strictEqual(imported.format, 'pdf');
  assert.strictEqual(imported.binary, true);
  assert.ok(imported.view_url, 'import must provide view_url (saved to docs)');
  assert.ok(
    !imported.binary_base64,
    'import PDF must not return binary_base64 payload'
  );
  const impRaw = await request('GET', imported.view_url);
  assert.strictEqual(impRaw.status, 200);
  assert.strictEqual(impRaw.body.slice(0, 4).toString(), '%PDF');

  const lines = [
    'health1: ' + health1.status + ' ' + health1.body.toString(),
    'health2: ' + health2.status,
    'open status: ' + open.status,
    'open body: ' + open.body.toString(),
    'raw status: ' + raw.status,
    'raw content-type: ' + ct,
    'raw header: ' + raw.body.slice(0, 8).toString(),
    'raw len: ' + raw.body.length,
    'import status: ' + imp.status,
    'import body keys: ' + Object.keys(imported).join(','),
    'import view_url: ' + imported.view_url,
    'import has_base64: ' + Boolean(imported.binary_base64),
    'import raw header: ' + impRaw.body.slice(0, 8).toString(),
    'PASS',
  ];
  logLines('pdf-open-api.log', lines);
  console.log('ok API open/import/raw');
  return { opened, imported };
}

async function testUi() {
  if (process.env.SKIP_UI === '1') {
    console.log('SKIP_UI=1 — skipping Playwright');
    logLines('pdf-ui-launch.log', ['SKIP_UI=1']);
    return;
  }

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    logLines('pdf-ui-launch.log', [
      'Playwright not available: ' + e.message,
      'Falling back to unit/API coverage only.',
    ]);
    console.warn('Playwright unavailable, UI skipped');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', (r) =>
    logs.push('REQFAIL: ' + r.url() + ' ' + (r.failure() && r.failure().errorText))
  );

  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 });
    const hasPdfJs = await page.evaluate(() => !!window.pdfjsLib);
    const hasHelpers = await page.evaluate(() => !!window.CognitionPdf);
    assert.ok(hasPdfJs, 'pdfjsLib must load');
    assert.ok(hasHelpers, 'CognitionPdf helpers must load');

    // Sidebar open multipage
    await page.waitForTimeout(400);
    const clickable = page.locator('.doc-item').filter({ hasText: 'sample-multipage' });
    const n = await clickable.count();
    assert.ok(n > 0, 'sample-multipage.pdf must appear in Documents list');
    await clickable.first().click();
    await page.waitForTimeout(5000);

    const afterSidebar = await page.evaluate(() => ({
      bodyPdfOpen: document.body.classList.contains('pdf-open'),
      pdfHidden: document.getElementById('pdf-viewer').classList.contains('hidden'),
      canvasCount: document.querySelectorAll('#pdf-pages canvas').length,
      pageLabel: document.getElementById('pdf-page-label')?.textContent,
      status: document.getElementById('status-text')?.textContent,
      editorShellDisplay: getComputedStyle(document.getElementById('editor-shell')).display,
      pdfViewerDisplay: getComputedStyle(document.getElementById('pdf-viewer')).display,
      editorText: (document.getElementById('editor')?.innerText || '').slice(0, 80),
    }));

    assert.strictEqual(afterSidebar.bodyPdfOpen, true, 'body.pdf-open');
    assert.strictEqual(afterSidebar.pdfHidden, false, 'viewer visible');
    assert.ok(
      afterSidebar.canvasCount >= 1,
      'expected canvas pages, got ' + afterSidebar.canvasCount
    );
    assert.strictEqual(afterSidebar.editorShellDisplay, 'none', 'editor hidden');
    assert.ok(
      !/%PDF|endobj|stream/i.test(afterSidebar.editorText || ''),
      'editor must not show PDF binary garbage'
    );

    // Open Document path (file input) with fixture
    await page.setInputFiles('#file-open-input', FIXTURE);
    await page.waitForTimeout(5000);
    const afterImport = await page.evaluate(() => ({
      bodyPdfOpen: document.body.classList.contains('pdf-open'),
      pdfHidden: document.getElementById('pdf-viewer').classList.contains('hidden'),
      canvasCount: document.querySelectorAll('#pdf-pages canvas').length,
      pageLabel: document.getElementById('pdf-page-label')?.textContent,
      status: document.getElementById('status-text')?.textContent,
    }));
    assert.strictEqual(afterImport.bodyPdfOpen, true, 'import body.pdf-open');
    assert.ok(afterImport.canvasCount >= 1, 'import canvases');

    const shot = path.join(SCRATCH, 'pdf-open-ui.png');
    await page.screenshot({ path: shot, fullPage: true });

    logLines('pdf-open-ui.log', [
      'hasPdfJs: ' + hasPdfJs,
      'hasHelpers: ' + hasHelpers,
      'AFTER_SIDEBAR: ' + JSON.stringify(afterSidebar, null, 2),
      'AFTER_IMPORT: ' + JSON.stringify(afterImport, null, 2),
      'LOGS:\n' + logs.join('\n'),
      'screenshot: ' + shot,
      'PASS',
    ]);
    logLines('pdf-import.log', [
      'import_ui canvasCount: ' + afterImport.canvasCount,
      'import_ui status: ' + afterImport.status,
      'import_ui pageLabel: ' + afterImport.pageLabel,
      'PASS',
    ]);
    console.log('ok UI sidebar + import');
  } finally {
    await browser.close();
  }
}

(async () => {
  try {
    await testApi();
    await testUi();
    console.log('ALL PDF OPEN TESTS PASSED');
    process.exit(0);
  } catch (e) {
    console.error('FAIL', e);
    try {
      logLines('pdf-open-failure.log', [String(e && e.stack || e)]);
    } catch {
      /* ignore */
    }
    process.exit(1);
  }
})();
