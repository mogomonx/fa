// Applies the saved site colours. Loaded as a plain <script> in the <head> of every page.
// Re-applies when a page is restored from the back/forward cache and when the
// colours are changed in another tab.
(function () {
  var KEY = 'fa-site-colours';
  var applied = [];

  function apply() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
    var root = document.documentElement;
    // Drop anything that is no longer saved (e.g. after "Reset to default").
    applied.forEach(function (k) { if (!(k in saved)) root.style.removeProperty(k); });
    applied = Object.keys(saved);
    applied.forEach(function (k) { root.style.setProperty(k, saved[k]); });
  }

  apply();
  window.addEventListener('pageshow', function (e) { if (e.persisted) apply(); });
  window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === null) apply(); });
})();
