// Misc statistics added 2026-10-28: Podiums & Wins, Sub-X Clubs, Attendance, Kinch What-If.
//
// Podiums, Attendance and the What-If follow the On This Date / Time frame view:
// full-results.json is never time-travelled itself, so each one filters its entries
// by the saved dates (dateWindow). Sub-X Clubs and the What-If read store.rankings,
// which time travel already swaps.
//
// The pure helpers (validForPodium, buildPodiumMap, clubsFor, buildAttendance,
// parseWhatIfResult, computeWhatIf) are exported so they can be tested on their own.

import { store, state } from '../store.js';
import { formatDate, formatResultLike, roundLabelFallback } from '../format.js';
import { nameLink, renderTable, addPositionColumn } from '../ui.js';
import { mountPersonPicker } from '../person-picker.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const byId = (id) => document.getElementById(id);

// ---------- shared helpers ----------

const nameOf = (wcaId, fallback) => store.people?.get(wcaId)?.name || fallback || wcaId;

// The dates the data is currently limited to: On This Date caps the end, the
// Time frame sets a start and/or end. Both are ISO "YYYY-MM-DD" strings (or null).
export function dateWindow() {
  const frame = store.timeFrame || {};
  let end = store.timeTravelDate || null;
  if (frame.end && (!end || frame.end < end)) end = frame.end;
  return { start: frame.start || null, end };
}

// Entries without a date are ignored, as everywhere else on the site.
export function inWindow(date, w) {
  if (!date) return false;
  if (w.end && date > w.end) return false;
  if (w.start && date < w.start) return false;
  return true;
}

const windowKey = (w) => `${w.start || ''}|${w.end || ''}`;

// ---------- Podiums & Wins ----------

// Round codes of a final: 'f' (final) and 'c' (combined final). A one-round event's
// only round is one of these too.
const FINAL_ROUNDS = new Set(['f', 'c']);
// Rounds of these events are ranked by the best single, not an average.
const BEST_RANKED = new Set(['333bf', '444bf', '555bf', '333mbf']);

// A podium only counts when the person has a valid ranking result in that round.
// (Without this, everyone with only DNFs ties for last and "finishes" on the podium.)
export function validForPodium(e) {
  const single = typeof e.single === 'number' ? e.single : 0;
  const average = typeof e.average === 'number' ? e.average : 0;
  if (BEST_RANKED.has(e.eventId)) return single > 0;
  if (average > 0) return true;
  if (average < 0) return false; // DNF / DNS average
  return single > 0; // round format without an average: ranked by best
}

// wcaId -> { name, events: Map(eventId -> [gold, silver, bronze]) }
export function buildPodiumMap(entries, w) {
  const map = new Map();
  for (const e of entries || []) {
    if (!FINAL_ROUNDS.has(e.round)) continue;
    const pos = Number(e.pos);
    if (!(pos >= 1 && pos <= 3)) continue;
    if (!inWindow(e.date, w) || !validForPodium(e)) continue;
    let p = map.get(e.wcaId);
    if (!p) {
      p = { name: e.name, events: new Map() };
      map.set(e.wcaId, p);
    }
    let c = p.events.get(e.eventId);
    if (!c) {
      c = [0, 0, 0];
      p.events.set(e.eventId, c);
    }
    c[pos - 1] += 1;
  }
  return map;
}

let podiumCache = { entries: null, key: '', map: null };

function podiumMap() {
  const entries = store.fullResults?.entries || [];
  const w = dateWindow();
  const key = windowKey(w);
  if (podiumCache.entries !== entries || podiumCache.key !== key) {
    podiumCache = { entries, key, map: buildPodiumMap(entries, w) };
  }
  return podiumCache.map;
}

export function renderPodiums() {
  const container = byId('podium-table');
  if (!container) return;
  const eventId = state.podiumEventId || '';
  const sort = state.podiumSort || 'wins';

  const rows = [];
  for (const [wcaId, p] of podiumMap()) {
    let counts;
    if (eventId) {
      counts = p.events.get(eventId);
      if (!counts) continue;
    } else {
      counts = [0, 0, 0];
      for (const c of p.events.values()) {
        counts[0] += c[0];
        counts[1] += c[1];
        counts[2] += c[2];
      }
    }
    rows.push({
      wcaId,
      name: nameOf(wcaId, p.name),
      gold: counts[0],
      silver: counts[1],
      bronze: counts[2],
      total: counts[0] + counts[1] + counts[2],
    });
  }

  if (rows.length === 0) {
    container.innerHTML = '<p class="empty-note">No podium finishes yet.</p>';
    return;
  }

  const keys = sort === 'podiums' ? ['total', 'gold', 'silver', 'bronze'] : ['gold', 'total', 'silver', 'bronze'];
  rows.sort((a, b) => {
    for (const k of keys) if (b[k] !== a[k]) return b[k] - a[k];
    return a.name.localeCompare(b.name);
  });

  const medal = (n, cls) => (n ? `<span class="${cls}">${n}</span>` : '0');
  renderTable(container, rows, [
    { key: 'rank', label: '#', value: () => '' },
    { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
    { key: 'gold', label: 'Wins', value: (r) => medal(r.gold, 'pr-order-1') },
    { key: 'silver', label: '2nd', value: (r) => medal(r.silver, 'pr-order-2') },
    { key: 'bronze', label: '3rd', value: (r) => medal(r.bronze, 'pr-order-3') },
    { key: 'total', label: 'Podiums', value: (r) => r.total },
  ]);
  addPositionColumn('podium-table');
}

// ---------- Sub-X Clubs ----------

// The clubs shown per event and type, in seconds (3x3x3 Fewest Moves: moves).
// Edit freely: nothing else depends on these numbers. Multi-Blind has no clubs.
export const SUBX_THRESHOLDS = {
  '222': { single: [5, 4, 3, 2, 1.5, 1], average: [10, 7, 5, 4, 3, 2.5, 2, 1.5] },
  '333': { single: [30, 20, 15, 12, 10, 8, 7, 6, 5, 4], average: [60, 30, 25, 20, 15, 12, 10, 9, 8, 7] },
  '444': { single: [90, 60, 45, 40, 30, 25, 20, 18], average: [120, 90, 60, 45, 40, 35, 30, 25, 22, 20] },
  '555': { single: [120, 90, 75, 60, 50, 45, 40, 35, 30], average: [180, 120, 90, 75, 60, 50, 45, 40, 35] },
  '666': { single: [240, 180, 150, 120, 100, 90, 80], average: [300, 240, 180, 150, 120, 100, 90] },
  '777': { single: [300, 240, 200, 180, 150, 120, 110], average: [420, 300, 240, 200, 180, 150, 120] },
  '333bf': { single: [300, 180, 120, 90, 60, 45, 30, 20, 15], average: [600, 300, 180, 120, 90, 60] },
  '333fm': { single: [35, 30, 28, 26, 25, 24, 23, 22, 21, 20], average: [40, 35, 30, 28, 26, 24, 22, 20] },
  '333oh': { single: [30, 20, 15, 12, 10, 9, 8, 7, 6], average: [60, 40, 30, 25, 20, 17, 15, 13, 12, 10] },
  clock: { single: [20, 15, 10, 8, 6, 5, 4, 3], average: [30, 20, 15, 12, 10, 8, 7, 6, 5, 4] },
  minx: { single: [90, 75, 60, 50, 45, 40, 35, 30, 25], average: [120, 90, 75, 60, 50, 45, 40, 35, 30] },
  pyram: { single: [20, 15, 10, 8, 6, 5, 4, 3, 2, 1.5], average: [30, 20, 15, 12, 10, 8, 7, 6, 5, 4, 3] },
  skewb: { single: [20, 15, 10, 8, 6, 5, 4, 3, 2, 1.5], average: [30, 20, 15, 12, 10, 8, 7, 6, 5, 4, 3] },
  sq1: { single: [60, 45, 30, 25, 20, 15, 12, 10, 8, 6], average: [90, 60, 45, 40, 30, 25, 20, 18, 15, 12, 10] },
  '444bf': { single: [900, 600, 420, 300, 240, 180], average: [1200, 900, 600, 420, 300] },
  '555bf': { single: [1800, 1200, 900, 600, 420, 300], average: [2400, 1800, 1200, 900] },
  fto: { single: [90, 60, 45, 30, 25, 20, 15, 10], average: [120, 90, 60, 45, 30, 25, 20, 15] },
};

const MAX_CLUB_NAMES = 40;

// 90 -> "1:30", 2.5 -> "2.5", 3600 -> "1:00:00"
export function formatThreshold(t) {
  if (t < 60) return String(t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.round(t % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// rows: ranked rows, fastest first. unitOf turns a stored value into the threshold's
// unit. Returns one club per threshold (largest first), stopping after the first
// threshold nobody has reached yet.
export function clubsFor(rows, thresholds, unitOf) {
  const out = [];
  for (const t of [...thresholds].sort((a, b) => b - a)) {
    let k = 0;
    while (k < rows.length && unitOf(rows[k].value) < t) k += 1;
    out.push({ threshold: t, count: k, members: rows.slice(0, Math.min(k, MAX_CLUB_NAMES)) });
    if (k === 0) break;
  }
  return out;
}

export function renderSubX() {
  const list = byId('subx-list');
  const note = byId('subx-note');
  if (!list || !note) return;
  const events = store.rankings?.events || [];
  const eventId = state.subxEventId || events[0]?.id;
  const ev = events.find((e) => e.id === eventId);
  if (!ev) {
    list.innerHTML = '';
    note.textContent = '';
    return;
  }

  const type = ev.hasAverage === false ? 'single' : state.subxType || 'single';
  const thresholds = SUBX_THRESHOLDS[ev.id]?.[type];
  if (!thresholds) {
    note.textContent = ev.id === '333mbf' ? 'Multi-Blind has no sub-X clubs.' : 'No clubs are set up for this event yet.';
    list.innerHTML = '';
    return;
  }

  const isFmc = ev.id === '333fm';
  const unitOf = isFmc ? (type === 'average' ? (v) => v / 100 : (v) => v) : (v) => v / 100;
  note.textContent = isFmc
    ? `Everyone with a ${type} under each number of moves. Everyone in a faster club is in the slower ones too.`
    : `Everyone with a ${type} under each time, in seconds (or minutes:seconds). Everyone in a faster club is in the slower ones too.`;

  const clubs = clubsFor(ev[type] || [], thresholds, unitOf);
  list.innerHTML = `<div class="club-list">${clubs
    .map((c) => {
      const title = `Sub-${formatThreshold(c.threshold)}`;
      if (c.count === 0) {
        return `<div class="club-row"><div class="club-head"><span class="club-title">${esc(title)}</span><span class="club-count">nobody yet</span></div></div>`;
      }
      const names = c.members
        .map((r) => `${nameLink(r.wcaId, r.name)} <span class="club-result">(${esc(r.display)})</span>`)
        .join(', ');
      const more = c.count > c.members.length ? ` <span class="club-result">and ${c.count - c.members.length} more</span>` : '';
      return `<div class="club-row"><div class="club-head"><span class="club-title">${esc(title)}</span><span class="club-count">${c.count} ${c.count === 1 ? 'person' : 'people'}</span></div><div class="club-members">${names}${more}</div></div>`;
    })
    .join('')}</div>`;
}

// ---------- Attendance ----------

const MILESTONES = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000];

// people: wcaId -> { name, comps: Set, rounds, solves, first, last }
// comps:  competitionId -> { id, name, date, people: Set }
export function buildAttendance(entries, w) {
  const people = new Map();
  const comps = new Map();
  for (const e of entries || []) {
    if (!inWindow(e.date, w)) continue;
    let p = people.get(e.wcaId);
    if (!p) {
      p = { name: e.name, comps: new Set(), rounds: 0, solves: 0, first: e.date, last: e.date };
      people.set(e.wcaId, p);
    }
    p.comps.add(e.competitionId);
    p.rounds += 1;
    if (Array.isArray(e.attempts)) {
      for (const v of e.attempts) if (typeof v === 'number' && v !== 0 && v !== -2) p.solves += 1;
    }
    if (e.date < p.first) p.first = e.date;
    if (e.date > p.last) p.last = e.date;

    let c = comps.get(e.competitionId);
    if (!c) {
      c = { id: e.competitionId, name: e.competitionName || e.competitionId, date: e.date, people: new Set() };
      comps.set(e.competitionId, c);
    }
    c.people.add(e.wcaId);
  }
  return { people, comps };
}

let attendanceCache = { entries: null, key: '', data: null };

function attendanceData() {
  const entries = store.fullResults?.entries || [];
  const w = dateWindow();
  const key = windowKey(w);
  if (attendanceCache.entries !== entries || attendanceCache.key !== key) {
    attendanceCache = { entries, key, data: buildAttendance(entries, w) };
  }
  return attendanceCache.data;
}

export function renderAttendance() {
  const view = state.attendanceView || 'people';
  const peopleView = byId('attendance-people-view');
  const compsView = byId('attendance-competitions-view');
  if (!peopleView || !compsView) return;
  peopleView.style.display = view === 'people' ? '' : 'none';
  compsView.style.display = view === 'competitions' ? '' : 'none';

  const { people, comps } = attendanceData();

  if (view === 'people') {
    const container = byId('attendance-people-table');
    const rows = Array.from(people, ([wcaId, p]) => ({
      wcaId,
      name: nameOf(wcaId, p.name),
      comps: p.comps.size,
      rounds: p.rounds,
      solves: p.solves,
      first: p.first,
      last: p.last,
    })).sort((a, b) => b.comps - a.comps || b.rounds - a.rounds || a.name.localeCompare(b.name));
    if (rows.length === 0) {
      container.innerHTML = '<p class="empty-note">No results yet.</p>';
      return;
    }
    renderTable(container, rows, [
      { key: 'rank', label: '#', value: () => '' },
      { key: 'name', label: 'Name', value: (r) => nameLink(r.wcaId, r.name) },
      { key: 'comps', label: 'Competitions', value: (r) => r.comps },
      { key: 'rounds', label: 'Rounds', value: (r) => r.rounds },
      { key: 'solves', label: 'Solves', value: (r) => r.solves },
      { key: 'first', label: 'First', value: (r) => formatDate(r.first) },
      { key: 'last', label: 'Latest', value: (r) => formatDate(r.last) },
      {
        key: 'next',
        label: 'Next milestone',
        value: (r) => {
          const next = MILESTONES.find((m) => m > r.comps);
          return next ? `${next} (${next - r.comps} to go)` : '—';
        },
      },
    ]);
    addPositionColumn('attendance-people-table');
    return;
  }

  const container = byId('attendance-competitions-table');
  const rows = Array.from(comps.values())
    .map((c) => ({ id: c.id, name: c.name, date: c.date, count: c.people.size }))
    .sort((a, b) => b.count - a.count || b.date.localeCompare(a.date))
    .slice(0, 100);
  if (rows.length === 0) {
    container.innerHTML = '<p class="empty-note">No results yet.</p>';
    return;
  }
  renderTable(container, rows, [
    { key: 'rank', label: '#', value: () => '' },
    {
      key: 'name',
      label: 'Competition',
      value: (r) =>
        `<a href="https://www.worldcubeassociation.org/competitions/${encodeURIComponent(r.id)}" target="_blank" rel="noopener">${esc(r.name)}</a>`,
    },
    { key: 'date', label: 'Date', value: (r) => formatDate(r.date) },
    { key: 'count', label: 'Members', value: (r) => r.count },
  ]);
  addPositionColumn('attendance-competitions-table');
}

// ---------- Kinch What-If ----------

// Turns what was typed into a stored result value, or an error message.
//   time events: "9.50", "9.5", "62.33", "1:02.33", "1:02:03.45"  -> centiseconds
//   Fewest Moves: single "24", average "26.33"                      -> moves / moves * 100
//   Multi-Blind:  "5/6 39:09" or "11/12 1:03:22"                    -> WCA multi-blind number
export function parseWhatIfResult(text, eventId, isAverage) {
  const t = String(text ?? '').trim().replace(',', '.');
  if (!t) return { empty: true };

  if (eventId === '333mbf') {
    const m = t.match(/^(\d+)\s*\/\s*(\d+)\s+(\d+):(\d{2})(?::(\d{2}))?$/);
    if (!m) return { error: 'Multi-Blind looks like 5/6 39:09 (solved/attempted, then the time).' };
    const solved = Number(m[1]);
    const attempted = Number(m[2]);
    const seconds = m[5] !== undefined ? Number(m[3]) * 3600 + Number(m[4]) * 60 + Number(m[5]) : Number(m[3]) * 60 + Number(m[4]);
    if (attempted < 2 || solved > attempted) return { error: 'At least 2 cubes must be attempted, and solved cannot be more than attempted.' };
    const missed = attempted - solved;
    const points = solved - missed;
    if (points < 1) return { error: 'That would be a DNF: you need more cubes solved than missed.' };
    if (points > 98) return { error: 'Too many points to store.' };
    if (!(seconds > 0) || seconds > 99998) return { error: 'That time is not possible.' };
    return { value: (99 - points) * 10000000 + seconds * 100 + missed };
  }

  if (eventId === '333fm') {
    if (isAverage) {
      if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: 'A Fewest Moves average looks like 26.33.' };
      const v = Math.round(Number(t) * 100);
      return v > 0 ? { value: v } : { error: 'That is not possible.' };
    }
    if (!/^\d+$/.test(t)) return { error: 'A Fewest Moves single is a whole number of moves, like 24.' };
    const v = Number(t);
    return v > 0 ? { value: v } : { error: 'That is not possible.' };
  }

  const parts = t.split(':');
  if (parts.length > 3 || !parts.every((p, i) => (i === parts.length - 1 ? /^\d+(\.\d{1,2})?$/.test(p) : /^\d+$/.test(p)))) {
    return { error: 'Type a time like 9.50 or 1:02.33.' };
  }
  const nums = parts.map(Number);
  let cs = 0;
  if (nums.length === 3) cs = nums[0] * 360000 + nums[1] * 6000 + Math.round(nums[2] * 100);
  else if (nums.length === 2) cs = nums[0] * 6000 + Math.round(nums[1] * 100);
  else cs = Math.round(nums[0] * 100);
  return cs > 0 ? { value: cs } : { error: 'That is not possible.' };
}

const placeholderFor = (eventId, isAverage) => {
  if (eventId === '333mbf') return 'e.g. 5/6 39:09';
  if (eventId === '333fm') return isAverage ? 'e.g. 26.33' : 'e.g. 24';
  return 'e.g. 9.50 or 1:02.33';
};

// First position of an equal value in a sorted list (so ties share a rank).
function posIn(list, id, key) {
  const i = list.findIndex((r) => r.wcaId === id);
  if (i < 0) return null;
  let j = i;
  while (j > 0 && list[j - 1][key] === list[i][key]) j -= 1;
  return { pos: j + 1, row: list[i] };
}

function changeCell(diff, goodWhenPositive, digits, unit) {
  const d = Math.round(diff * 10 ** digits) / 10 ** digits;
  if (!d) return '—';
  const good = goodWhenPositive ? d > 0 : d < 0;
  const sign = d > 0 ? '+' : '\u2212';
  const n = Math.abs(d).toFixed(digits);
  const suffix = unit ? ` ${unit}${Math.abs(d) === 1 ? '' : 's'}` : '';
  return `<span class="${good ? 'whatif-up' : 'whatif-down'}">${sign}${n}${suffix}</span>`;
}

// Rebuilds the people list from the current rankings in the shape computeRankings
// wants, and ranks everyone once as the baseline. Cached until the rankings change
// (time travel swaps store.rankings).
let baseCache = { rankings: null, data: null };

function baseData(core) {
  const r = store.rankings;
  if (baseCache.rankings === r) return baseCache.data;
  const byId = new Map();
  const people = (r.people || []).map((p) => {
    const o = { wcaId: p.wcaId, name: p.name, countryIso2: p.countryIso2 || null, events: {} };
    byId.set(p.wcaId, o);
    return o;
  });
  for (const ev of r.events || []) {
    for (const type of ['single', 'average']) {
      for (const row of ev[type] || []) {
        const p = byId.get(row.wcaId);
        if (!p) continue;
        const slot = (p.events[ev.id] ||= { single: null, average: null });
        slot[type] = row.value;
      }
    }
  }
  const ids = new Set((r.events || []).map((e) => e.id));
  const events = core.activeEvents().filter((e) => ids.has(e.id));
  const data = { people, events, baseline: core.computeRankings(people, events) };
  baseCache = { rankings: r, data };
  return data;
}

// What would change if this person's `type` result in this event became `value`
// (it replaces their current result, better or not)?
export function computeWhatIf(core, base, wcaId, eventId, type, value) {
  const idx = base.people.findIndex((p) => p.wcaId === wcaId);
  const eventDef = base.events.find((e) => e.id === eventId);
  if (idx < 0 || !eventDef) return null;
  const cur = base.people[idx];
  const people = base.people.slice();
  people[idx] = {
    ...cur,
    events: { ...cur.events, [eventId]: { ...(cur.events[eventId] || { single: null, average: null }), [type]: value } },
  };
  const before = base.baseline;
  const after = core.computeRankings(people, base.events);

  const kb = posIn(before.kinch.overall, wcaId, 'score');
  const ka = posIn(after.kinch.overall, wcaId, 'score');
  const sb = posIn(before.sumOfRanks[type], wcaId, 'total');
  const sa = posIn(after.sumOfRanks[type], wcaId, 'total');
  if (!kb || !ka || !sb || !sa) return null;
  const eb = before.events.find((e) => e.id === eventId)?.[type]?.find((r) => r.wcaId === wcaId) || null;
  const ea = after.events.find((e) => e.id === eventId)?.[type]?.find((r) => r.wcaId === wcaId) || null;
  const cb = kb.row.components[eventId]?.score ?? 0;
  const ca = ka.row.components[eventId]?.score ?? 0;

  const rows = [
    { label: 'Kinch score', now: kb.row.score.toFixed(2), then: ka.row.score.toFixed(2), change: changeCell(ka.row.score - kb.row.score, true, 2) },
    { label: 'Kinch rank', now: `#${kb.pos}`, then: `#${ka.pos}`, change: changeCell(kb.pos - ka.pos, true, 0, 'place') },
    { label: `${eventDef.name} Kinch score`, now: cb.toFixed(2), then: ca.toFixed(2), change: changeCell(ca - cb, true, 2) },
    {
      label: `${eventDef.name} ${type} rank`,
      now: eb ? `#${eb.rank}` : '—',
      then: ea ? `#${ea.rank}` : '—',
      change: eb && ea ? changeCell(eb.rank - ea.rank, true, 0, 'place') : ea ? '<span class="whatif-up">new</span>' : '—',
    },
    { label: `Sum of Ranks (${type})`, now: String(sb.row.total), then: String(sa.row.total), change: changeCell(sa.row.total - sb.row.total, false, 0) },
    { label: `Sum of Ranks (${type}) rank`, now: `#${sb.pos}`, then: `#${sa.pos}`, change: changeCell(sb.pos - sa.pos, true, 0, 'place') },
  ];

  const currentValue = cur.events[eventId]?.[type];
  const isAvg = type === 'average';
  return {
    rows,
    eventName: eventDef.name,
    currentDisplay: typeof currentValue === 'number' && currentValue > 0 ? core.formatResult(currentValue, eventDef, isAvg) : null,
    newDisplay: core.formatResult(value, eventDef, isAvg),
    worse: typeof currentValue === 'number' && currentValue > 0 && value > currentValue,
  };
}

let whatIfToken = 0;
let whatIfWired = false;

function wireWhatIf() {
  if (whatIfWired) return;
  whatIfWired = true;
  byId('whatif-person-select')?.addEventListener('change', () => drawWhatIf());
  const input = byId('whatif-input');
  let timer = null;
  input?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => drawWhatIf(), 250);
  });
}

function populateWhatIfPeople() {
  const sel = byId('whatif-person-select');
  if (!sel) return;
  mountPersonPicker(sel, { getPeople: () => store.rankings?.kinch?.overall || [], defaultToMe: true });
}

// The group's entry: fills the person list, then draws.
export function renderWhatIf() {
  wireWhatIf();
  populateWhatIfPeople();
  drawWhatIf();
}

// Redraws the answer only (the person list is left alone).
export async function drawWhatIf() {
  const my = ++whatIfToken;
  const table = byId('whatif-table');
  const note = byId('whatif-note');
  const input = byId('whatif-input');
  const sel = byId('whatif-person-select');
  if (!table || !note || !input || !sel) return;

  const events = store.rankings?.events || [];
  const eventId = state.whatifEventId || events[0]?.id;
  const ev = events.find((e) => e.id === eventId);
  const wcaId = sel.value;
  if (!ev || !wcaId) {
    table.innerHTML = '';
    note.textContent = 'Pick a person and an event.';
    return;
  }

  const singleOnly = ev.hasAverage === false;
  const type = singleOnly ? 'single' : state.whatifType || 'single';
  input.placeholder = placeholderFor(ev.id, type === 'average');

  const parsed = parseWhatIfResult(input.value, ev.id, type === 'average');
  if (parsed.empty) {
    table.innerHTML = '';
    note.textContent = `Type a ${type} result for ${ev.name} to see what it would change.${singleOnly ? ' (Multi-Blind only has a single.)' : ''}`;
    return;
  }
  if (parsed.error) {
    table.innerHTML = '';
    note.textContent = parsed.error;
    return;
  }

  let core;
  try {
    core = await import('../rankings-core.js');
  } catch (e) {
    table.innerHTML = '';
    note.textContent = 'Could not load the calculator.';
    return;
  }
  if (my !== whatIfToken) return;

  let out;
  try {
    out = computeWhatIf(core, baseData(core), wcaId, ev.id, type, parsed.value);
  } catch (e) {
    console.error('Kinch what-if failed:', e);
    table.innerHTML = '';
    note.textContent = 'Could not work that out.';
    return;
  }
  if (!out) {
    table.innerHTML = '';
    note.textContent = 'That person or event is not in the current rankings.';
    return;
  }

  const who = nameOf(wcaId, '');
  note.textContent =
    `${who}'s current ${type} in ${out.eventName}: ${out.currentDisplay ?? 'no result yet'}. Below: what happens with ${out.newDisplay} instead.` +
    (out.worse ? ' (That is slower than the current result, so it replaces a better one.)' : '');
  renderTable(table, out.rows, [
    { key: 'label', label: '', value: (r) => esc(r.label) },
    { key: 'now', label: 'Now', value: (r) => esc(r.now) },
    { key: 'then', label: 'With this result', value: (r) => esc(r.then) },
    { key: 'change', label: 'Change', value: (r) => r.change },
  ]);
}
