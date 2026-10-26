// Loads the admin view (moved out of admin.html so the page needs no inline script).
// Loaded by dynamic import so a missing file shows a message instead of a blank page.
import('./admin-page.js')
  .then((m) => m.initAdmin())
  .catch((err) => {
    console.warn('Admin unavailable:', err);
    const g = document.getElementById('admin-gate');
    g.hidden = false;
    g.textContent = 'The admin view could not load. Check that every admin file was uploaded, then hard refresh.';
  });
