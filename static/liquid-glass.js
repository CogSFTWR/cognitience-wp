/**
 * Cognition WP — Liquid Glass material math + DOM driver.
 * Pure functions are testable without a browser DOM.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.CognitionLiquidGlass = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Map pointer position relative to a surface rect into specular % and refraction px.
   * @param {number} clientX
   * @param {number} clientY
   * @param {{left:number,top:number,width:number,height:number}} rect
   * @param {{maxRefract?: number}} [opts]
   * @returns {{ x: number, y: number, rx: number, ry: number, nx: number, ny: number }}
   */
  function specularFromPointer(clientX, clientY, rect, opts) {
    const maxRefract = (opts && opts.maxRefract) != null ? opts.maxRefract : 6;
    const w = Math.max(rect.width, 1);
    const h = Math.max(rect.height, 1);
    const nx = clamp((clientX - rect.left) / w, 0, 1);
    const ny = clamp((clientY - rect.top) / h, 0, 1);
    // Specular sits slightly above the pointer for a top-lit glass read.
    const x = round2(nx * 100);
    const y = round2(clamp(ny * 100 * 0.85 + 6, 0, 100));
    // Refraction displacement: subtle offset away from center.
    const rx = round2((nx - 0.5) * 2 * maxRefract);
    const ry = round2((ny - 0.5) * 2 * maxRefract * 0.65);
    return { x, y, rx, ry, nx, ny };
  }

  /**
   * Scroll-driven specular bias (document peeks under chrome).
   * @param {number} scrollTop
   * @param {number} maxScroll
   * @returns {{ x: number, y: number, rx: number, ry: number }}
   */
  function specularFromScroll(scrollTop, maxScroll) {
    const t = maxScroll > 0 ? clamp(scrollTop / maxScroll, 0, 1) : 0;
    return {
      x: round2(48 + t * 8),
      y: round2(14 + t * 22),
      rx: round2(t * 2.5),
      ry: round2(t * 4),
    };
  }

  /**
   * Blend pointer + scroll contributions for a surface.
   */
  function blendSpecular(pointer, scroll, pointerWeight) {
    const pw = pointerWeight == null ? 0.82 : pointerWeight;
    const sw = 1 - pw;
    if (!pointer && !scroll) {
      return { x: 50, y: 18, rx: 0, ry: 0 };
    }
    if (!pointer) return { ...scroll };
    if (!scroll) return { x: pointer.x, y: pointer.y, rx: pointer.rx, ry: pointer.ry };
    return {
      x: round2(pointer.x * pw + scroll.x * sw),
      y: round2(pointer.y * pw + scroll.y * sw),
      rx: round2(pointer.rx * pw + scroll.rx * sw),
      ry: round2(pointer.ry * pw + scroll.ry * sw),
    };
  }

  function applySpecularVars(el, specular) {
    if (!el || !el.style || !specular) return false;
    el.style.setProperty('--specular-x', specular.x + '%');
    el.style.setProperty('--specular-y', specular.y + '%');
    el.style.setProperty('--refract-x', specular.rx + 'px');
    el.style.setProperty('--refract-y', specular.ry + 'px');
    return true;
  }

  /**
   * Drive all liquid-glass surfaces from pointer + optional scroll metrics.
   * Interruptible: only sets CSS vars / transform-friendly offsets.
   */
  function updateSurfaces(surfaces, clientX, clientY, scroll) {
    if (!surfaces || !surfaces.length) return 0;
    let n = 0;
    const scrollSpec =
      scroll && typeof scroll.scrollTop === 'number'
        ? specularFromScroll(scroll.scrollTop, scroll.maxScroll || 0)
        : null;

    for (let i = 0; i < surfaces.length; i++) {
      const el = surfaces[i];
      if (!el || !el.getBoundingClientRect) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const ptr =
        typeof clientX === 'number' && typeof clientY === 'number'
          ? specularFromPointer(clientX, clientY, rect)
          : null;
      const mixed = blendSpecular(ptr, scrollSpec, ptr ? 0.82 : 0);
      if (applySpecularVars(el, mixed)) n++;
    }
    return n;
  }

  function querySurfaces(root) {
    const doc = root || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.querySelectorAll) return [];
    return Array.prototype.slice.call(
      doc.querySelectorAll(
        '.liquid-glass, .glass, .glass-menu, .floating-glass, .glass-btn:not(#save-btn)'
      )
    );
  }

  /**
   * Attach pointer + scroll listeners. Returns dispose().
   */
  function attach(options) {
    const opts = options || {};
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return function dispose() {};
    }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-transparency: reduce)').matches) {
      return function dispose() {};
    }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Still allow a static default; skip continuous tracking.
      return function dispose() {};
    }

    let raf = 0;
    let lastX = window.innerWidth * 0.5;
    let lastY = 80;
    const scrollEl = opts.scrollEl || document.getElementById('center');

    function scrollMetrics() {
      if (!scrollEl) return { scrollTop: 0, maxScroll: 0 };
      const max = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      return { scrollTop: scrollEl.scrollTop || 0, maxScroll: max };
    }

    function tick() {
      raf = 0;
      const surfaces = typeof opts.getSurfaces === 'function' ? opts.getSurfaces() : querySurfaces();
      updateSurfaces(surfaces, lastX, lastY, scrollMetrics());
    }

    function schedule() {
      if (raf) return;
      raf = window.requestAnimationFrame(tick);
    }

    function onPointer(e) {
      lastX = e.clientX;
      lastY = e.clientY;
      schedule();
    }

    function onScroll() {
      schedule();
    }

    window.addEventListener('pointermove', onPointer, { passive: true });
    if (scrollEl) scrollEl.addEventListener('scroll', onScroll, { passive: true });
    schedule();

    return function dispose() {
      window.removeEventListener('pointermove', onPointer);
      if (scrollEl) scrollEl.removeEventListener('scroll', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  /**
   * Position a magnifying loupe content layer so focus (local coords) sits at center.
   * @param {number} focusX - pointer X relative to content origin
   * @param {number} focusY - pointer Y relative to content origin
   * @param {number} loupeSize - loupe diameter in px
   * @param {number} scale - magnification
   * @returns {{ tx: number, ty: number, scale: number }}
   */
  function loupeContentOffset(focusX, focusY, loupeSize, scale) {
    const s = scale == null ? 1.65 : scale;
    const half = (loupeSize == null ? 120 : loupeSize) / 2;
    return {
      tx: round2(half - focusX * s),
      ty: round2(half - focusY * s),
      scale: s,
    };
  }

  /**
   * Place floating selection capsule above a selection rect, clamped in a host rect.
   * All rects in the same coordinate space (e.g. paper-local or viewport).
   */
  function floatingToolbarLayout(selRect, hostRect, opts) {
    const o = opts || {};
    const barH = o.barHeight == null ? 44 : o.barHeight;
    const gap = o.gap == null ? 8 : o.gap;
    const pad = o.pad == null ? 8 : o.pad;
    const halfW = o.halfWidth == null ? 90 : o.halfWidth;
    const midX = selRect.left + selRect.width / 2 - hostRect.left;
    let top = selRect.top - hostRect.top - barH - gap;
    if (top < pad) {
      // Flip below selection when not enough room above
      top = selRect.bottom - hostRect.top + gap;
    }
    top = clamp(top, pad, Math.max(pad, hostRect.height - barH - pad));
    const left = clamp(midX, pad + halfW, Math.max(pad + halfW, hostRect.width - pad - halfW));
    return { left: round2(left), top: round2(top) };
  }

  return {
    specularFromPointer,
    specularFromScroll,
    blendSpecular,
    applySpecularVars,
    updateSurfaces,
    querySurfaces,
    attach,
    loupeContentOffset,
    floatingToolbarLayout,
    clamp,
    round2,
  };
});
