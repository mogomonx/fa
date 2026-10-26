// Loads the site home page (moved out of home.html so the page needs no inline script).
// Loaded by dynamic import so a backend problem can't break the page.
import('./home-page.js')
  .then((m) => m.initHome())
  .catch((err) => {
    console.warn('Home unavailable:', err);
    const d = document.querySelector('#my-profile-card .card-desc');
    if (d) d.textContent = 'Not available right now.';
  });
