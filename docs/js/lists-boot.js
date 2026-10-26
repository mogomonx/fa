// Loads the lists page (moved out of lists.html so the page needs no inline script).
// Loaded by dynamic import so a backend/CDN problem shows a message instead of a blank page.
const status = document.getElementById('lists-status');

import('./lists-page.js')
  .then((m) => m.initLists())
  .then(() => status.remove())
  .catch((err) => {
    console.warn('Lists unavailable:', err);
    status.textContent = 'Could not load lists. Please try again later.';
  });
