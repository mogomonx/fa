import { store } from '../store.js';
import { flagEmoji, kinchColor } from '../format.js';
import { medalRowClass } from '../ui.js';
import { showProfile } from './profile.js';

// WCA profile pictures aren't in our data files, so they're fetched from the
// public WCA API in the browser and cached in localStorage for a week.
const AVATAR_KEY = 'fa-avatars';
const AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const inflight = new Map();

function loadAvatarCache() {
  try {
    return JSON.parse(localStorage.getItem(AVATAR_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function saveAvatarCache(cache) {
  try {
    localStorage.setItem(AVATAR_KEY, JSON.stringify(cache));
  } catch (e) {
    // storage full or blocked -- avatars just won't be cached
  }
}

function fetchAvatarUrl(wcaId) {
  if (!inflight.has(wcaId)) {
    const p = fetch(`https://www.worldcubeassociation.org/api/v0/persons/${wcaId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`WCA API ${res.status}`);
        return res.json();
      })
      .then((data) => data.person?.avatar?.thumb_url || data.person?.avatar?.url || null)
      .finally(() => inflight.delete(wcaId));
    inflight.set(wcaId, p);
  }
  return inflight.get(wcaId);
}

function applyAvatar(el, url) {
  if (!el || !url) return;
  const img = new Image();
  img.alt = '';
  img.className = 'avatar-img';
  img.onload = () => {
    el.textContent = '';
    el.appendChild(img);
  };
  img.src = url;
}

function loadAvatars(container) {
  const cache = loadAvatarCache();
  const now = Date.now();
  const missing = [];
  container.querySelectorAll('.avatar').forEach((el) => {
    const id = el.dataset.wcaid;
    const hit = cache[id];
    if (hit && now - hit.t < AVATAR_TTL_MS) applyAvatar(el, hit.url);
    else missing.push(el);
  });
  if (missing.length === 0) return;

  Promise.allSettled(
    missing.map((el) =>
      fetchAvatarUrl(el.dataset.wcaid).then((url) => {
        cache[el.dataset.wcaid] = { url, t: Date.now() };
        applyAvatar(el, url);
      })
    )
  ).then(() => saveAvatarCache(cache));
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function renderMembers() {
  const container = document.getElementById('members-table');
  if (!container || !store.rankings) return;

  const kinchByWca = new Map(
    (store.rankings.kinch?.overall || []).map((r, i) => [r.wcaId, { score: r.score, pos: i + 1 }])
  );

  const members = (store.rankings.people || []).slice().sort((a, b) => {
    const ka = kinchByWca.get(a.wcaId);
    const kb = kinchByWca.get(b.wcaId);
    if (ka && kb) return ka.pos - kb.pos;
    if (ka) return -1;
    if (kb) return 1;
    return a.name.localeCompare(b.name);
  });

  if (members.length === 0) {
    container.innerHTML = '<p class="empty-note">No members yet.</p>';
    return;
  }

  const rows = members
    .map((p) => {
      const k = kinchByWca.get(p.wcaId);
      const cls = ['member-row', k ? medalRowClass(k.pos) : ''].filter(Boolean).join(' ');
      const flag = flagEmoji(p.countryIso2) || '';
      return `
        <tr class="${cls}" data-wcaid="${p.wcaId}" tabindex="0" role="link">
          <td class="rank-cell">${k ? k.pos : '—'}</td>
          <td class="avatar-cell"><span class="avatar" data-wcaid="${p.wcaId}">${initials(p.name)}</span></td>
          <td>${p.name}</td>
          <td>${flag}<span class="country-code">${p.countryIso2 || ''}</span></td>
          <td>${k ? `<span style="color:${kinchColor(k.score)}">${k.score.toFixed(2)}</span>` : '—'}</td>
        </tr>`;
    })
    .join('');

  container.innerHTML = `
    <table>
      <thead><tr><th>Kinch</th><th></th><th>Name</th><th>Country</th><th>Score</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  if (!container.dataset.bound) {
    container.dataset.bound = '1';
    container.addEventListener('click', (e) => {
      const row = e.target.closest('.member-row');
      if (row) showProfile(row.dataset.wcaid);
    });
    container.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('.member-row');
      if (row) {
        e.preventDefault();
        showProfile(row.dataset.wcaid);
      }
    });
  }

  loadAvatars(container);
}
