// Applies the saved site colours and font. Loaded as a plain <script> in the <head> of every page.
// Re-applies when a page is restored from the back/forward cache and when the
// colours or font are changed in another tab.
//
// A font picked on its own (settings page, "Font") is saved separately from the
// colours and wins over the font that belongs to a colour preset.
(function () {
  var KEY = 'fa-site-colours';
  var FONT_KEY = 'fa-site-font';
  var applied = [];

  function apply() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
    var font = null;
    try { font = JSON.parse(localStorage.getItem(FONT_KEY) || 'null'); } catch (e) {}
    var root = document.documentElement;
    // Drop anything that is no longer saved (e.g. after "Reset to default").
    applied.forEach(function (k) { if (!(k in saved)) root.style.removeProperty(k); });
    root.style.removeProperty('--font');
    applied = Object.keys(saved);
    applied.forEach(function (k) { root.style.setProperty(k, saved[k]); });
    if (font && font.stack) root.style.setProperty('--font', font.stack);
  }

  apply();
  window.addEventListener('pageshow', function (e) { if (e.persisted) apply(); });
  window.addEventListener('storage', function (e) {
    if (e.key === KEY || e.key === FONT_KEY || e.key === null) apply();
  });
})();
