// Applies the saved site colours. Loaded as a plain <script> in the <head> of every page.
(function () {
  try {
    var saved = JSON.parse(localStorage.getItem('fa-site-colours') || '{}');
    for (var k in saved) document.documentElement.style.setProperty(k, saved[k]);
  } catch (e) {}
})();
