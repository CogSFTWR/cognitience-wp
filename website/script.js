(function () {
  var toggle = document.getElementById('theme-toggle');
  var moon = document.getElementById('theme-icon-moon');
  var sun = document.getElementById('theme-icon-sun');

  function syncIcon() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (moon && sun) {
      moon.style.display = dark ? '' : 'none';
      sun.style.display = dark ? 'none' : '';
    }
  }

  if (toggle) {
    toggle.addEventListener('click', function () {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      var next = dark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('cog-theme', next); } catch (e) {}
      syncIcon();
    });
    syncIcon();
  }

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var reducedTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)').matches;

  if (!reducedMotion && !reducedTransparency) {
    var raf = null;
    var pending = null;

    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

    function applySpecular(el, clientX, clientY) {
      var rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      var nx = clamp((clientX - rect.left) / rect.width, 0, 1);
      var ny = clamp((clientY - rect.top) / rect.height, 0, 1);
      el.style.setProperty('--specular-x', (nx * 100).toFixed(2) + '%');
      el.style.setProperty('--specular-y', clamp(ny * 100 * 0.85 + 6, 0, 100).toFixed(2) + '%');
    }

    document.querySelectorAll('.liquid-glass').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        pending = { el: el, x: e.clientX, y: e.clientY };
        if (!raf) {
          raf = requestAnimationFrame(function () {
            raf = null;
            if (pending) {
              applySpecular(pending.el, pending.x, pending.y);
              pending = null;
            }
          });
        }
      });
      el.addEventListener('pointerleave', function () {
        el.style.setProperty('--specular-x', '48%');
        el.style.setProperty('--specular-y', '16%');
      });
    });
  }
})();
