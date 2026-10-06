import { store } from '../store.js';
import { formatDate, flagEmoji } from '../format.js';
import { nameLink, renderTable } from '../ui.js';
import { showProfile } from './profile.js';

export function renderFaRecords() {
  const container = document.getElementById('fa-records-table');
  const table = document.createElement('table');
  table.innerHTML = `<thead><tr>
    <th>Event</th>
    <th>Single record</th>
    <th>Held by</th>
    <th>Average record</th>
    <th>Held by</th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');

  for (const event of store.rankings.events) {
    const singleHolders = (event.single || []).filter((r) => r.rank === 1);
    const averageHolders = event.hasAverage ? (event.average || []).filter((r) => r.rank === 1) : [];

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${event.name}</td>
      <td>${singleHolders[0] ? singleHolders[0].display : '—'}</td>
      <td>${singleHolders.map((h) => nameLink(h.wcaId, h.name)).join(', ') || '—'}</td>
      <td>${event.hasAverage ? (averageHolders[0] ? averageHolders[0].display : '—') : 'N/A'}</td>
      <td>${event.hasAverage ? (averageHolders.map((h) => nameLink(h.wcaId, h.name)).join(', ') || '—') : 'N/A'}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.innerHTML = '';
  container.appendChild(table);
}

export function renderRecentActivity() {
  const container = document.getElementById('recent-activity-table');
  const note = document.getElementById('recent-activity-note');
  const data = store.recentActivity;
  if (!data) {
    container.innerHTML = '<p class="empty-note">No data yet (needs the Update Full Result History workflow to have run).</p>';
    return;
  }
  const items = data.items || [];
  note.textContent = `PR1/PR2/PR3 and podium finishes in the last ${data.windowDays || 14} days.`;
  if (items.length === 0) {
    container.innerHTML = '<p class="empty-note">Nothing in the last two weeks.</p>';
    return;
  }
  renderTable(container, items, [
    { key: 'date', label: 'Date', value: (r) => formatDate(r.date) },
    { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'event', label: 'Event', value: (r) => r.eventName },
    { key: 'badges', label: 'Achievement', value: (r) => r.badges.join(', ') },
    { key: 'comp', label: 'Competition', value: (r) => [r.competitionName, r.round].filter(Boolean).join(' \u2013 ') },
  ]);
}

export function setupProfileSearch() {
  const input = document.getElementById('profile-search');
  const results = document.getElementById('profile-search-results');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    results.innerHTML = '';
    if (q.length === 0) return;
    const matches = Array.from(store.people.entries())
      .filter(([, p]) => p.name.toLowerCase().includes(q))
      .slice(0, 8);
    matches.forEach(([wcaId, p]) => {
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'search-result-item';
      a.textContent = `${flagEmoji(p.countryIso2) ? flagEmoji(p.countryIso2) + ' ' : ''}${p.name}`;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        input.value = '';
        results.innerHTML = '';
        showProfile(wcaId);
      });
      results.appendChild(a);
    });
  });
}
