// The small "My profile" button in the top right of the lists page.
// First click creates the personal profile (a private one-person list);
// after it's built, the button opens it.

import { supabase } from './auth.js';

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

export function setupProfileButton({ wcaId, name }) {
  document.getElementById('profile-btn')?.remove();
  if (!wcaId) return; // logged out, or a WCA account with no WCA ID

  const avatar = document.createElement('span');
  avatar.className = 'profile-avatar small';
  loadAvatar(avatar, wcaId, name);

  const label = document.createElement('span');
  label.textContent = 'My profile';

  const btn = document.createElement('button');
  btn.id = 'profile-btn';
  btn.type = 'button';
  btn.className = 'profile-btn';
  btn.title = 'Your personal profile';
  btn.append(avatar, label);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const { data, error } = await supabase.rpc('my_lists');
      if (error) throw error;
      const personal = (data || []).find((l) => l.kind === 'personal');

      if (!personal) {
        if (!confirm('Create your personal profile page? It takes a few minutes to build the first time.')) return;
        const created = await supabase.rpc('create_my_profile');
        if (created.error) throw created.error;
        alert('Your profile is being built. Check back in a few minutes; this button will open it.');
      } else if (personal.data_level === 'none') {
        alert('Your profile is still being built. Check back in a few minutes.');
      } else {
        window.location.href = rankingsUrl(personal);
      }
    } catch (err) {
      alert(err?.message || 'Something went wrong. Please try again.');
    } finally {
      btn.disabled = false;
    }
  });

  document.body.appendChild(btn);
}
