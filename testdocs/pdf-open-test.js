const { chromium } = require('playwright');

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
  console.log('hasPdfJs', await page.evaluate(() => !!window.pdfjsLib));
  await page.waitForTimeout(800);

  const items = await page.locator('.doc-item').allTextContents();
  console.log('sidebar', items);

  const count = await page.locator('.doc-item').count();
  if (count) {
    await page.locator('.doc-item').filter({ hasText: 'hello' }).first().click();
  }
  await page.waitForTimeout(4000);

  const after = await page.evaluate(() => ({
    bodyPdfOpen: document.body.classList.contains('pdf-open'),
    pdfHidden: document.getElementById('pdf-viewer').classList.contains('hidden'),
    pagesHTML: (document.getElementById('pdf-pages') || {}).innerHTML?.slice(0, 400),
    canvasCount: document.querySelectorAll('#pdf-pages canvas').length,
    iframeSrc: (document.getElementById('pdf-frame') || {}).src,
    iframeHidden: document.getElementById('pdf-frame').classList.contains('hidden'),
    pageLabel: document.getElementById('pdf-page-label')?.textContent,
    status: document.getElementById('status-text')?.textContent,
    editorShellDisplay: getComputedStyle(document.getElementById('editor-shell')).display,
    pdfViewerDisplay: getComputedStyle(document.getElementById('pdf-viewer')).display,
    pdfViewerH: document.getElementById('pdf-viewer').offsetHeight,
    pdfPagesH: document.getElementById('pdf-pages').offsetHeight,
  }));
  console.log('AFTER', JSON.stringify(after, null, 2));
  console.log('LOGS:\n' + logs.join('\n'));
  await page.screenshot({ path: 'testdocs/pdf-open.png', fullPage: true });
  console.log('screenshot written');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
