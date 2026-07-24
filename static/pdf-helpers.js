/**
 * Pure PDF open/source helpers used by the viewer and unit tests.
 * Works in browser and Node (no DOM required).
 */
(function (root) {
  'use strict';

  function isPdfDoc(doc) {
    if (!doc) return false;
    return (
      doc.format === 'pdf' ||
      doc.binary === true ||
      String(doc.ext || '')
        .toLowerCase()
        .replace(/^\./, '') === 'pdf'
    );
  }

  function isPdfFileName(name, mime) {
    if (mime === 'application/pdf') return true;
    return /\.pdf$/i.test(String(name || ''));
  }

  /** Absolute worker URL so pdf.js works under Electron and nested routes. */
  function pdfWorkerSrc(baseHref) {
    const base =
      baseHref ||
      (typeof location !== 'undefined' && location.href
        ? location.href
        : 'http://127.0.0.1/');
    try {
      return new URL('vendor/pdf.worker.min.js', base).href;
    } catch {
      return 'vendor/pdf.worker.min.js';
    }
  }

  function base64ToUint8Array(b64) {
    if (typeof b64 !== 'string' || !b64) {
      throw new Error('empty base64');
    }
    // Browser
    if (typeof atob === 'function') {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    }
    // Node
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(b64, 'base64'));
    }
    throw new Error('no base64 decoder');
  }

  /**
   * Map an OpenedFile-like payload to a pdf.js getDocument source.
   * Prefer streamable URL / raw bytes over base64.
   *
   * @returns {{ kind: 'url'|'data', value: string|Uint8Array } | null}
   */
  function resolvePdfSource(doc) {
    if (!isPdfDoc(doc)) return null;

    if (doc.view_url) {
      return { kind: 'url', value: String(doc.view_url) };
    }

    // Prefer typed bytes (client File import) — never require base64 for large files
    if (doc.binary_data != null) {
      const data =
        doc.binary_data instanceof Uint8Array
          ? doc.binary_data
          : new Uint8Array(doc.binary_data);
      if (data.length) return { kind: 'data', value: data };
    }

    if (doc.binary_base64) {
      try {
        const data = base64ToUint8Array(doc.binary_base64);
        return { kind: 'data', value: data };
      } catch {
        return null;
      }
    }

    if (doc.path) {
      return {
        kind: 'url',
        value: '/api/files/raw?path=' + encodeURIComponent(doc.path),
      };
    }

    return null;
  }

  /**
   * Build options for pdfjsLib.getDocument from a resolved source.
   */
  function getDocumentOptions(source) {
    if (!source) return null;
    if (source.kind === 'url') {
      return { url: source.value, withCredentials: false };
    }
    if (source.kind === 'data') {
      // pdf.js copies the buffer; pass a slice so the original remains usable
      const data = source.value;
      return { data: data.buffer ? data.slice(0) : data };
    }
    return null;
  }

  const api = {
    isPdfDoc,
    isPdfFileName,
    pdfWorkerSrc,
    base64ToUint8Array,
    resolvePdfSource,
    getDocumentOptions,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.CognitionPdf = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
