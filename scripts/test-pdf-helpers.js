/**
 * Unit tests for static/pdf-helpers.js — drives the real shipped module.
 * No mocks of the unit under test.
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const helpersPath = path.join(__dirname, '..', 'static', 'pdf-helpers.js');
assert.ok(fs.existsSync(helpersPath), 'pdf-helpers.js must exist in static/');
const helpers = require(helpersPath);

function run() {
  // workerSrc absolute
  const worker = helpers.pdfWorkerSrc('http://127.0.0.1:8799/');
  assert.ok(worker.startsWith('http://127.0.0.1:8799/'), 'workerSrc absolute: ' + worker);
  assert.ok(worker.endsWith('vendor/pdf.worker.min.js'), 'workerSrc path: ' + worker);

  // isPdfDoc
  assert.strictEqual(helpers.isPdfDoc({ format: 'pdf' }), true);
  assert.strictEqual(helpers.isPdfDoc({ binary: true, ext: 'pdf' }), true);
  assert.strictEqual(helpers.isPdfDoc({ ext: 'PDF' }), true);
  assert.strictEqual(helpers.isPdfDoc({ format: 'markdown' }), false);
  assert.strictEqual(helpers.isPdfDoc(null), false);

  assert.strictEqual(helpers.isPdfFileName('x.pdf', ''), true);
  assert.strictEqual(helpers.isPdfFileName('x.txt', 'application/pdf'), true);
  assert.strictEqual(helpers.isPdfFileName('x.txt', 'text/plain'), false);

  // resolve: view_url preferred
  const fromView = helpers.resolvePdfSource({
    format: 'pdf',
    binary: true,
    view_url: '/api/files/raw?path=sample-multipage.pdf',
    binary_base64: 'SHOULD_NOT_USE',
  });
  assert.deepStrictEqual(fromView, {
    kind: 'url',
    value: '/api/files/raw?path=sample-multipage.pdf',
  });

  // resolve: binary_data preferred over base64
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
  const fromData = helpers.resolvePdfSource({
    format: 'pdf',
    binary: true,
    binary_data: bytes,
    binary_base64: Buffer.from('junk').toString('base64'),
  });
  assert.strictEqual(fromData.kind, 'data');
  assert.ok(fromData.value instanceof Uint8Array);
  assert.strictEqual(fromData.value[0], 0x25);

  // resolve: path fallback
  const fromPath = helpers.resolvePdfSource({
    format: 'pdf',
    path: 'docs/hello.pdf',
  });
  assert.strictEqual(fromPath.kind, 'url');
  assert.ok(fromPath.value.includes('hello.pdf'));
  assert.ok(fromPath.value.startsWith('/api/files/raw'));

  // resolve: base64
  const b64 = Buffer.from('%PDF-1.4 test').toString('base64');
  const fromB64 = helpers.resolvePdfSource({
    format: 'pdf',
    binary_base64: b64,
  });
  assert.strictEqual(fromB64.kind, 'data');
  assert.strictEqual(Buffer.from(fromB64.value).toString().slice(0, 4), '%PDF');

  // getDocumentOptions
  const urlOpts = helpers.getDocumentOptions(fromView);
  assert.strictEqual(urlOpts.url, fromView.value);
  assert.strictEqual(urlOpts.withCredentials, false);

  const dataOpts = helpers.getDocumentOptions(fromData);
  assert.ok(dataOpts.data, 'data option for typed bytes');

  // real fixture PDF must resolve and start with %PDF when loaded as data
  const fixture = path.join(__dirname, '..', 'testdocs', 'sample-multipage.pdf');
  assert.ok(fs.existsSync(fixture), 'sample-multipage.pdf fixture required');
  const pdfBytes = new Uint8Array(fs.readFileSync(fixture));
  assert.ok(pdfBytes.length > 2000, 'fixture should be multi-KB, got ' + pdfBytes.length);
  assert.strictEqual(Buffer.from(pdfBytes.slice(0, 4)).toString(), '%PDF');
  const resolvedFixture = helpers.resolvePdfSource({
    format: 'pdf',
    binary: true,
    binary_data: pdfBytes,
  });
  assert.strictEqual(resolvedFixture.kind, 'data');
  assert.strictEqual(resolvedFixture.value.length, pdfBytes.length);

  console.log('ok pdf-helpers unit tests passed');
}

run();
