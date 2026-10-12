// The "My profile" card on the site home page.
// Logged out: starts the WCA login. Logged in: first click creates the personal
// profile (a private one-person list); once built, the card opens it.

import { supabase, startWcaLogin } from './auth.js';

const AVATAR_KEY = 'fa-my-avatar';
const rankingsUrl = (list) => `index.html?list=${encodeURIComponent(list.slug)}`;

// WCA profile picture, cached for a week. Falls back to initials.
async function loadAvatar(node, wcaId, name) {
  const initials = (name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  node.textContent = initials;

  let url = null;
  try {
    const c = JSON.parse(localStorage.getItem(AVATAR_KEY) || 'null');
    if (c && c.wcaId === wcaId && Date.now() - c.at < 7 * 24 * 3600 * 1000) url = c.url;
  } catch { /* ignore */ }

  if (!url) {
    try {
      const res = await fetch(`https://www.worldcubeassociation.org/api/v0/persons/${wcaId}`);
      if (res.ok) {
        const d = await res.json();
        url = d?.person?.avatar?.thumb_url || d?.person?.avatar?.url || null;
        try { localStorage.setItem(AVATAR_KEY, JSON.stringify({ wcaId, url, at: Date.now() })); } catch { /* ignore */ }
      }
    } catch { /* offline or blocked: keep initials */ }
  }
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.className = 'profile-avatar-img';
    img.addEventListener('error', () => { node.textContent = initials; });
    node.replaceChildren(img);
  }
}

// `card` is the <a id="my-profile-card"> on home.html (has .profile-avatar and .card-desc inside).
export function setupProfileCard(card, { wcaId, name, loggedIn }) {
  if (!card) return;
  const avatar = card.querySelector('.profile-avatar');
  const desc = card.querySelector('.card-desc');

  if (loggedIn && wcaId) {
    if (avatar) { avatar.hidden = false; loadAvatar(avatar, wcaId, name); }
    desc.textContent = 'Your personal stats page: records, results, rolling averages and name settings.';
  } else if (loggedIn) {
    desc.textContent = "Your WCA account has no WCA ID yet, so there's no profile to build.";
  } else {
    desc.textContent = 'Log in with WCA to open your personal stats page.';
  }

  let busy = false;
  card.addEventListener('click', async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!loggedIn) { startWcaLogin(); return; }
    if (!wcaId) return;
    busy = true;
    try {
      const { data, error } = await supabase.rpc('my_lists');
      if (error) throw error;
      const personal = (data || []).find((l) => l.kind === 'personal');

      if (!personal) {
        if (!confirm('Create your personal profile page? It takes a few minutes to build the first time.')) return;
        const created = await supabase.rpc('create_my_profile');
        if (created.error) throw created.error;
        alert('Your profile is being built. Check back in a few minutes; this card will open it.');
      } else if (personal.data_level === 'none') {
        alert('Your profile is still being built. Check back in a few minutes.');
      } else {
        window.location.href = rankingsUrl(personal);
      }
    } catch (err) {
      alert(err?.message || 'Something went wrong. Please try again.');
    } finally {
      busy = false;
    }
  });
}
