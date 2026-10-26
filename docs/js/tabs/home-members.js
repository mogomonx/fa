import { store } from '../store.js';
import { nameLink } from '../ui.js';

// Compact member directory for the Home page, in Kinch order (falls back to
// the list order). Re-run by renderAll, so time travel updates it too.
// nameLink escapes names itself, so it gets the plain name.
export function renderHomeMembers() {
  const box = document.getElementById('home-members');
  if (!box || !store.rankings) return;

  const kinch = store.rankings.kinch?.overall || [];
  const ids = kinch.length
    ? kinch.map((r) => r.wcaId)
    : (store.rankings.people || []).map((p) => p.wcaId);
  if (!ids.length) {
    box.innerHTML = '';
    return;
  }

  const chips = ids
    .map((id) => {
      const name = store.people.get(id)?.name || id;
      return `<span class="member-chip">${nameLink(id, name)}</span>`;
    })
    .join('');
  box.innerHTML = `<h2>Members</h2><div class="member-chips">${chips}</div>`;
}
