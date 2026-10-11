import { store } from '../store.js';
import { formatResultLike } from '../format.js';
import { nameLink, renderTable, setupToggle } from '../ui.js';
import { eventIcon } from '../icons.js';

const H2H_IDS = ['h2h-person-1', 'h2h-person-2', 'h2h-person-3', 'h2h-person-4', 'h2h-person-5'];
const OPTIONAL_IDS = new Set(['h2h-person-3', 'h2h-person-4', 'h2h-person-5']);
const NEMESIS_ID = 'nemesis-person-select';
const CHASING_ID = 'chasing-person-select';
const ALL_IDS = [...H2H_IDS, NEMESIS_ID, CHASING_ID];

let h2hView = 'single';
let wired = false;
let defaultChecked = false;
let userChanged = false;

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const findRankEntry = (list, wcaId) => (list || []).find((r) => r.wcaId === wcaId) || null;
const personName = (wcaId) => store.people.get(wcaId)?.name || wcaId;

// Fills the person dropdowns. Safe to call repeatedly (time travel): uses
// onchange (no stacked listeners) and keeps the current selection.
export function populateCompareSelects() {
  const people = store.rankings.people || [];
  const previous = ALL_IDS.map((id) => $(id).value);

  ALL_IDS.forEach((id, i) => {
    const select = $(id);
    select.innerHTML = '';
    if (OPTIONAL_IDS.has(id)) {
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '(nobody)';
      select.appendChild(blank);
    }
    people.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.wcaId;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    if (previous[i] && people.some((p) => p.wcaId === previous[i])) select.value = previous[i];
  });
  if (!previous[1] && people.length > 1) $('h2h-person-2').value = people[1].wcaId;

  if (!wired) {
    wired = true;
    setupToggle('h2h-view-toggle', 'view', (v) => {
      h2hView = v;
      renderHeadToHead();
    });
  }
  H2H_IDS.forEach((id) => {
    $(id).onchange = () => {
      userChanged = true;
      renderHeadToHead();
    };
  });
  $(NEMESIS_ID).onchange = () => {
    userChanged = true;
    renderTrueNemesis();
  };
  $(CHASING_ID).onchange = () => {
    userChanged = true;
    renderChasing();
  };

  applyLoggedInDefault();
}

// Once per page load: if the visitor is logged in and on this list, start
// the first Head-to-Head box, Nemesis and Chasing on them.
async function applyLoggedInDefault() {
  if (defaultChecked) return;
  defaultChecked = true;
  try {
    const { supabase } = await import('../auth.js');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase.from('profiles').select('wca_id').eq('id', session.user.id).maybeSingle();
    const me = data?.wca_id;
    const people = store.rankings.people || [];
    if (!me || userChanged || !people.some((p) => p.wcaId === me)) return;

    $('h2h-person-1').value = me;
    if ($('h2h-person-2').value === me) {
      const other = people.find((p) => p.wcaId !== me);
      if (other) $('h2h-person-2').value = other.wcaId;
    }
    $(NEMESIS_ID).value = me;
    $(CHASING_ID).value = me;
    renderHeadToHead();
    renderNemesis();
  } catch (err) {
    console.warn('Could not default Compare to the logged-in user:', err);
  }
}

// ---------- Head-to-Head (2 to 5 people) ----------

export function renderHeadToHead() {
  const container = $('h2h-table');
  const ids = [...new Set(H2H_IDS.map((id) => $(id).value).filter(Boolean))];
  if (ids.length < 2) {
    container.innerHTML = '<p class="empty-note">Pick at least two different people.</p>';
    return;
  }

  const kinchRows = store.rankings.kinch?.overall || [];
  const rows = [];
  for (const event of store.rankings.events) {
    // Only events where everyone selected has a result.
    if (!ids.every((id) => findRankEntry(event.single, id))) continue;
    if (h2hView === 'average' && !event.hasAverage) continue;

    // One comparable number per person (or null), plus how to show it.
    const cells = {};
    const nums = {};
    for (const id of ids) {
      if (h2hView === 'kinch') {
        const k = kinchRows.find((r) => r.wcaId === id)?.components?.[event.id];
        nums[id] = k ? k.score : null;
        cells[id] = k ? k.score.toFixed(2) : '—';
      } else {
        const entry = findRankEntry(h2hView === 'average' ? event.average : event.single, id);
        nums[id] = entry ? entry.value : null;
        cells[id] = entry ? `${entry.display} (#${entry.rank})` : '—';
      }
    }
    const present = Object.values(nums).filter((v) => v != null);
    const best = present.length ? (h2hView === 'kinch' ? Math.max(...present) : Math.min(...present)) : null;
    for (const id of ids) {
      if (nums[id] != null && nums[id] === best && present.length > 1) {
        cells[id] = `<span class="rank-gold">${cells[id]}</span>`;
      }
    }
    rows.push({ event, cells });
  }

  if (!rows.length) {
    container.innerHTML = '<p class="empty-note">No events where everyone selected has a result.</p>';
    return;
  }
  renderTable(container, rows, [
    { key: 'event', label: 'Event', value: (r) => eventIcon(r.event.id, r.event.name) },
    ...ids.map((id) => ({ key: id, label: esc(personName(id)), value: (r) => r.cells[id] })),
  ]);
}

// ---------- Nemesis (true nemesis) ----------

// Does person B beat person A in every result A has, in both formats?
// A result A has that B lacks means no. Events A has nothing in are ignored.
function nemesizes(bId, aId) {
  let compared = 0;
  for (const event of store.rankings.events) {
    for (const type of ['single', 'average']) {
      if (type === 'average' && !event.hasAverage) continue;
      const list = event[type] || [];
      const a = findRankEntry(list, aId);
      if (!a) continue;
      const b = findRankEntry(list, bId);
      if (!b || !(b.value < a.value)) return false;
      compared += 1;
    }
  }
  return compared > 0;
}

const nameList = (people) =>
  `<ul class="member-list">${people.map((p) => `<li>${nameLink(p.wcaId, esc(p.name))}</li>`).join('')}</ul>`;

export function renderTrueNemesis() {
  const wcaId = $(NEMESIS_ID).value;
  const container = $('nemesis-table');
  if (!wcaId) return;

  const others = (store.rankings.people || []).filter((p) => p.wcaId !== wcaId);
  const nemeses = others.filter((p) => nemesizes(p.wcaId, wcaId));
  const victims = others.filter((p) => nemesizes(wcaId, p.wcaId));
  const name = esc(personName(wcaId));
  const count = (n) => `${n} nemes${n === 1 ? 'is' : 'es'}`;

  container.innerHTML = `
    <p><strong>${name} has ${count(nemeses.length)}.</strong></p>
    ${nemeses.length ? nameList(nemeses) : '<p class="board-note">Nobody beats them in every single and average.</p>'}
    <p style="margin-top:1.25rem;"><strong>${name} is the nemesis of ${victims.length} ${victims.length === 1 ? 'person' : 'people'}.</strong></p>
    ${victims.length ? nameList(victims) : ''}`;
}

// ---------- Chasing (whoever is ranked directly above you) ----------

export function renderChasing() {
  const wcaId = $(CHASING_ID).value;
  const container = $('chasing-table');
  if (!wcaId) return;

  const rows = [];
  for (const event of store.rankings.events) {
    for (const type of ['single', 'average']) {
      if (type === 'average' && !event.hasAverage) continue;
      const list = event[type] || [];
      const idx = list.findIndex((r) => r.wcaId === wcaId);
      if (idx === -1) continue;
      const me = list[idx];
      if (idx === 0) {
        rows.push({ eventId: event.id, event: event.name, type, ahead: null, gap: null, me });
      } else {
        const ahead = list[idx - 1];
        rows.push({ eventId: event.id, event: event.name, type, ahead, gap: me.value - ahead.value, me });
      }
    }
  }

  renderTable(container, rows, [
    { key: 'event', label: 'Event', value: (r) => eventIcon(r.eventId, r.event) },
    { key: 'type', label: 'Type', value: (r) => (r.type === 'single' ? 'Single' : 'Average') },
    { key: 'ahead', label: 'Ahead of you', value: (r) => (r.ahead ? nameLink(r.ahead.wcaId, esc(r.ahead.name)) : "You're #1!") },
    { key: 'their', label: 'Their result', value: (r) => (r.ahead ? r.ahead.display : '—') },
    { key: 'gap', label: 'Gap to catch them', value: (r) => (r.gap != null ? formatResultLike(r.gap, store.rankings.events.find((e) => e.id === r.eventId), r.type === 'average') : '—') },
  ]);
}

// main.js calls this one; it refreshes both views.
export function renderNemesis() {
  renderTrueNemesis();
  renderChasing();
}
