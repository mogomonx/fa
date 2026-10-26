import { store } from '../store.js';
import { formatDate, flagEmoji } from '../format.js';
import { nameLink, esc } from '../ui.js';
import { eventIcon } from '../icons.js';

// Upcoming is always live, so psych sheets use the live rankings even when
// On This Date / Time frame has swapped store.rankings.
const liveRankings = () => store.live?.rankings || store.rankings;
const eventList = () => liveRankings()?.events || [];
const nameOf = (a) => store.people.get(a.wcaId)?.name || a.name || a.wcaId;
const num = (v) => (v == null ? '—' : v);
const wcaUrl = (id) => `https://www.worldcubeassociation.org/competitions/${encodeURIComponent(id)}`;

const NOT_BUILT_NOTE =
  "Upcoming competitions haven't been built for this list yet. They're added a few minutes after a list is created, and refreshed daily.";

const dateText = (c) =>
  c.endDate && c.endDate !== c.date ? `${formatDate(c.date)} \u2013 ${formatDate(c.endDate)}` : formatDate(c.date);

const placeText = (c) => [c.country ? flagEmoji(c.country) : '', c.city || ''].filter(Boolean).join(' ') || '—';

// Event ids in the site's usual event order (unknown ids last).
function sortedEventIds(ids) {
  const order = new Map(eventList().map((e, i) => [e.id, i]));
  return [...ids].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
}

function iconsHtml(ids) {
  const byId = new Map(eventList().map((e) => [e.id, e]));
  return sortedEventIds(ids)
    .map((id) => eventIcon(id, byId.get(id)?.name || id))
    .join(' ');
}

// nameLink escapes names itself, so it gets the plain name.
function attendeeLinks(attendees) {
  return attendees.map((a) => nameLink(a.wcaId, nameOf(a))).join(', ');
}

// The list tables are plain tables (they wrap long cells instead of
// scrolling sideways); the wrapper only scrolls if the screen is very narrow.
const WRAP_STYLE = 'overflow-x:auto;';

let openId = null; // competition shown in the psych sheet view

// ---------- Misc > Upcoming Competitions ----------

export function renderUpcoming() {
  const note = document.getElementById('upcoming-note');
  const container = document.getElementById('upcoming-table');
  if (!note || !container) return;
  const up = store.upcoming;

  if (!up) {
    note.textContent = NOT_BUILT_NOTE;
    container.innerHTML = '';
    return;
  }
  if (up.skipped) {
    note.textContent = `Upcoming competitions aren't tracked for lists with more than ${Number(up.maxMembers) || 50} members.`;
    container.innerHTML = '';
    return;
  }
  if (up.kind === 'state') {
    renderStateUpcoming(note, container, up);
    return;
  }

  const comps = up.competitions || [];
  if (openId && !comps.some((c) => c.id === openId)) openId = null;
  if (openId) {
    renderDetail(note, container, comps.find((c) => c.id === openId));
    return;
  }

  if (comps.length === 0) {
    note.textContent =
      'No upcoming competitions in the next ~6 months have anyone from this list registered (only accepted registrations are visible).';
    container.innerHTML = '';
    return;
  }
  note.textContent = 'Upcoming competitions (next ~6 months) with people from this list registered. Click a competition for its psych sheet.';

  container.innerHTML = `
    <div style="${WRAP_STYLE}">
      <table>
        <thead><tr><th>Date</th><th>Competition</th><th>Where</th><th>Events</th><th>Attending</th></tr></thead>
        <tbody>
          ${comps
            .map(
              (c) => `
            <tr>
              <td style="white-space:nowrap;">${dateText(c)}</td>
              <td><a href="#" class="upcoming-open" data-comp="${esc(c.id)}">${esc(c.name)}</a></td>
              <td>${esc(placeText(c))}</td>
              <td style="min-width:9rem;">${iconsHtml(c.eventIds || [])}</td>
              <td>${(c.attendees || []).length}: ${attendeeLinks(c.attendees || [])}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll('.upcoming-open').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openId = a.dataset.comp;
      renderUpcoming();
    })
  );
}

// ---------- State lists: competitions held in the state ----------

// State lists have no members, so there are no registrations or psych sheets:
// just the competitions taking place in the state, linked to the WCA site.
function renderStateUpcoming(note, container, up) {
  const comps = up.competitions || [];
  openId = null;
  if (comps.length === 0) {
    note.textContent = 'No upcoming competitions in the next ~6 months were found in this state.';
    container.innerHTML = '';
    return;
  }
  note.textContent =
    'Upcoming competitions (next ~6 months) held in this state. Registrations aren\'t shown for state lists; open a competition on the WCA site to see who is going.';

  container.innerHTML = `
    <div style="${WRAP_STYLE}">
      <table>
        <thead><tr><th>Date</th><th>Competition</th><th>Where</th><th>Events</th></tr></thead>
        <tbody>
          ${comps
            .map(
              (c) => `
            <tr>
              <td style="white-space:nowrap;">${dateText(c)}</td>
              <td><a href="${wcaUrl(c.id)}" target="_blank" rel="noopener">${esc(c.name)}</a></td>
              <td>${esc(placeText(c))}</td>
              <td style="min-width:9rem;">${iconsHtml(c.eventIds || [])}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

// ---------- Psych sheet for one competition ----------

function renderDetail(note, container, comp) {
  note.textContent = 'Registered group members only, ranked by their result within the group. NR/CR/WR are their official WCA ranks.';
  const events = new Map(eventList().map((e) => [e.id, e]));

  const sections = sortedEventIds(comp.eventIds || [])
    .map((id) => {
      const attendees = (comp.attendees || []).filter((a) => (a.eventIds || []).includes(id));
      if (attendees.length === 0) return '';
      const ev = events.get(id);
      return `
        <div class="board" style="margin-bottom:1rem;">
          <h3 style="margin:0 0 0.5rem;">${eventIcon(id, ev?.name || id)} ${esc(ev?.name || id)}</h3>
          ${ev ? psychTable(ev, attendees) : `<p class="board-note">${attendeeLinks(attendees)}</p>`}
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <button type="button" class="back-link" id="upcoming-back">&larr; All upcoming competitions</button>
    <h2 style="margin:0 0 0.25rem;">${esc(comp.name)}</h2>
    <p class="board-note">${dateText(comp)} · ${esc(placeText(comp))} ·
      <a href="${wcaUrl(comp.id)}" target="_blank" rel="noopener">View on the WCA site</a> ·
      ${(comp.attendees || []).length} from this list registered</p>
    ${sections || '<p class="empty-note">No event registrations yet.</p>'}`;
  document.getElementById('upcoming-back').addEventListener('click', () => {
    openId = null;
    renderUpcoming();
  });
}

function psychTable(ev, attendees) {
  const big = 1e9;
  const rows = attendees.map((a) => ({
    a,
    s: (ev.single || []).find((r) => r.wcaId === a.wcaId),
    av: ev.hasAverage ? (ev.average || []).find((r) => r.wcaId === a.wcaId) : null,
  }));
  // Average events sort by group average rank first, then single; others by single.
  rows.sort(
    (x, y) =>
      (ev.hasAverage ? (x.av ? x.av.rank : big) - (y.av ? y.av.rank : big) : 0) ||
      (x.s ? x.s.rank : big) - (y.s ? y.s.rank : big) ||
      nameOf(x.a).localeCompare(nameOf(y.a))
  );

  const ranks = (r) => {
    const o = r?.officialRanks || {};
    return `<td class="dim">${num(o.country)}</td><td class="dim">${num(o.continent)}</td><td class="dim">${num(o.world)}</td>`;
  };
  const avgHead = ev.hasAverage ? '<th class="split-l">Average</th><th>NR</th><th>CR</th><th>WR</th>' : '';

  return `
    <div class="table-wrap">
      <table class="records-table">
        <thead><tr>
          <th>#</th><th class="event-name-cell">Name</th>
          <th>Single</th><th>NR</th><th>CR</th><th>WR</th>${avgHead}
        </tr></thead>
        <tbody>
          ${rows
            .map(
              ({ a, s, av }, i) => `
            <tr>
              <td>${i + 1}</td>
              <td class="event-name-cell">${nameLink(a.wcaId, nameOf(a))}</td>
              <td class="result-cell">${s ? esc(s.display) : '—'}</td>${ranks(s)}
              ${ev.hasAverage ? `<td class="result-cell split-l">${av ? esc(av.display) : '—'}</td>${ranks(av)}` : ''}
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

// ---------- Profile > Upcoming competitions tab ----------

export function upcomingProfileHtml(wcaId, personal) {
  const up = store.upcoming;
  if (!up) return `<p class="empty-note">${NOT_BUILT_NOTE}</p>`;
  if (up.skipped) return `<p class="empty-note">Upcoming competitions aren't tracked for lists with more than ${Number(up.maxMembers) || 50} members.</p>`;
  if (up.kind === 'state') return '<p class="empty-note">Registrations aren\'t tracked for state lists.</p>';

  const mine = (up.competitions || []).filter((c) => (c.attendees || []).some((a) => a.wcaId === wcaId));
  if (mine.length === 0) return '<p class="empty-note">Not registered for any upcoming competitions.</p>';

  return `
    <div style="${WRAP_STYLE}">
      <table>
        <thead><tr><th>Date</th><th>Competition</th><th>Where</th><th>Their events</th>${personal ? '' : '<th>Also going</th>'}</tr></thead>
        <tbody>
          ${mine
            .map((c) => {
              const me = c.attendees.find((a) => a.wcaId === wcaId);
              const others = c.attendees.filter((a) => a.wcaId !== wcaId);
              return `
            <tr>
              <td style="white-space:nowrap;">${dateText(c)}</td>
              <td><a href="${wcaUrl(c.id)}" target="_blank" rel="noopener">${esc(c.name)}</a></td>
              <td>${esc(placeText(c))}</td>
              <td style="min-width:9rem;">${iconsHtml(me.eventIds || [])}</td>
              ${personal ? '' : `<td>${others.length ? attendeeLinks(others) : '—'}</td>`}
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}
