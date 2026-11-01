// Rolling averages in the browser, worked out from full-results entries (store.fullResults.entries).
//
// This is the browser version of scripts/build-rolling-averages.js, used where that file's output
// (rolling-averages.json) is not built: state lists and, later, country pages. It gives the same
// rows (same ranks, windows, solve labels, tie order) as the Node script.
//
// KEEP IN SYNC with scripts/build-rolling-averages.js (formats, ordering, labels).
//
// Differences from the Node script, none of which change the result:
//  - Nothing is worked out until a table is asked for: one event + one format at a time, then cached.
//  - Each person's solves are grouped once per event (the Node script scans every entry for every
//    person and event), and the best window is found with a running sum and running min/max
//    instead of sorting every window. Only the winning window is expanded into solve objects.
//
// makeLazyRolling() returns an object shaped like rolling-averages.json
// ({ formats, events: [{ id, name, byFormat }] }), but byFormat[formatKey] is a getter that works the
// table out the first time it is read. So tabs/rolling.js and the profile page need no changes.

import { formatResultLike, roundLabelFallback } from './format.js';

export const ROLLING_FORMATS = [
  { key: 'mo3', label: 'Mo3', windowSize: 3, dropExtremes: false },
  { key: 'ao5', label: 'Ao5', windowSize: 5, dropExtremes: true },
  { key: 'ao12', label: 'Ao12', windowSize: 12, dropExtremes: true },
  { key: 'ao25', label: 'Ao25', windowSize: 25, dropExtremes: true },
  { key: 'ao50', label: 'Ao50', windowSize: 50, dropExtremes: true },
  { key: 'ao100', label: 'Ao100', windowSize: 100, dropExtremes: true },
];

const hasResult = (v) => typeof v === 'number' && v > 0;

// Fallback ordering of rounds within the same date, used only when the export's own round
// order (roundRank) isn't available on an entry.
const ROUND_ORDER = { 1: 1, 2: 2, 3: 3, 4: 4, c: 1, g: 1, e: 5, d: 6, f: 6, b: 6 };
const roundSortKey = (e) => e.roundRank ?? ROUND_ORDER[e.round] ?? 0;

function compareRounds(a, b) {
  const da = a.date || '9999';
  const db = b.date || '9999';
  if (da !== db) return da < db ? -1 : 1;
  return roundSortKey(a) - roundSortKey(b);
}

// wcaId -> { values, roundOf, attemptNo }: every valid solve of one event in time order
// (across rounds and competitions), with the round entry and attempt number each came from.
function solveSequences(entries, eventId) {
  const byPerson = new Map();
  for (const e of entries) {
    if (e.eventId !== eventId || !e.attempts || e.attempts.length === 0) continue;
    const list = byPerson.get(e.wcaId);
    if (list) list.push(e);
    else byPerson.set(e.wcaId, [e]);
  }
  const out = new Map();
  for (const [wcaId, rounds] of byPerson) {
    rounds.sort(compareRounds);
    const values = [];
    const roundOf = [];
    const attemptNo = [];
    for (const r of rounds) {
      for (let i = 0; i < r.attempts.length; i++) {
        const v = r.attempts[i];
        if (!hasResult(v)) continue; // DNF/DNS don't count for this stat
        values.push(v);
        roundOf.push(r);
        attemptNo.push(i + 1);
      }
    }
    out.set(wcaId, { values, roundOf, attemptNo });
  }
  return out;
}

// Best (lowest) rolling mean over every window of `windowSize` solves. With dropExtremes the best
// and worst solve of each window are left out. Returns { start, value } (the earliest window wins a
// tie) or null when there are too few solves. `scale` is 100 for FMC (the WCA stores means * 100).
function bestWindow(values, windowSize, dropExtremes, scale) {
  const n = values.length;
  if (n < windowSize) return null;
  const count = dropExtremes ? windowSize - 2 : windowSize;

  let sum = 0;
  for (let i = 0; i < windowSize; i++) sum += values[i];

  // Running minimum and maximum of the window (monotonic queues of indexes).
  const minQ = [];
  const maxQ = [];
  let minHead = 0;
  let maxHead = 0;
  const push = (i) => {
    const v = values[i];
    while (minQ.length > minHead && values[minQ[minQ.length - 1]] >= v) minQ.pop();
    minQ.push(i);
    while (maxQ.length > maxHead && values[maxQ[maxQ.length - 1]] <= v) maxQ.pop();
    maxQ.push(i);
  };
  if (dropExtremes) for (let i = 0; i < windowSize; i++) push(i);

  let bestValue = null;
  let bestStart = -1;
  for (let start = 0; start + windowSize <= n; start++) {
    if (start > 0) {
      const added = start + windowSize - 1;
      sum += values[added] - values[start - 1];
      if (dropExtremes) {
        push(added);
        while (minQ[minHead] < start) minHead++;
        while (maxQ[maxHead] < start) maxHead++;
      }
    }
    const counted = dropExtremes ? sum - values[minQ[minHead]] - values[maxQ[maxHead]] : sum;
    const mean = Math.round((counted / count) * scale);
    if (bestValue === null || mean < bestValue) {
      bestValue = mean;
      bestStart = start;
    }
  }
  return { start: bestStart, value: bestValue };
}

function solveLabel(seq, i) {
  const r = seq.roundOf[i];
  return `Solve ${seq.attemptNo[i]} \u2013 ${r.competitionName || r.competitionId} (${r.roundName || roundLabelFallback(r.round)})`;
}

// One person's row for one event and format, or null when they have too few solves.
function personRow(person, seq, format, event) {
  if (!seq) return null;
  const scale = event.id === '333fm' ? 100 : 1;
  const best = bestWindow(seq.values, format.windowSize, format.dropExtremes, scale);
  if (!best) return null;

  const first = best.start;
  const last = best.start + format.windowSize - 1;

  // Which solves of the winning window are dropped (the same pick as the Node script: stable sort
  // by value, first and last of the sorted order).
  const dropped = new Set();
  if (format.dropExtremes) {
    const idx = [];
    for (let i = first; i <= last; i++) idx.push(i);
    idx.sort((a, b) => seq.values[a] - seq.values[b]);
    dropped.add(idx[0]);
    dropped.add(idx[idx.length - 1]);
  }
  const solves = [];
  for (let i = first; i <= last; i++) {
    solves.push({
      display: formatResultLike(seq.values[i], event, false),
      dropped: dropped.has(i),
      label: solveLabel(seq, i),
    });
  }
  return {
    wcaId: person.wcaId,
    name: person.name,
    value: best.value,
    display: formatResultLike(best.value, event, true),
    rangeLabel: `${solveLabel(seq, first)} \u2192 ${solveLabel(seq, last)}`,
    solves,
  };
}

/**
 * Ranked rolling table for one event and one format.
 * people: [{ wcaId, name }] (their order breaks ties, like the Node script). sequences: from
 * solveSequences(). Returns rows sorted best first, each with a `rank`.
 */
export function buildRollingRows(people, sequences, event, format) {
  const rows = [];
  for (const p of people) {
    const row = personRow(p, sequences.get(p.wcaId), format, event);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => a.value - b.value);
  let place = 0;
  let lastValue = null;
  rows.forEach((r, i) => {
    if (r.value !== lastValue) {
      place = i + 1;
      lastValue = r.value;
    }
    r.rank = place;
  });
  return rows;
}

export { solveSequences };

/**
 * Lazy version of rolling-averages.json.
 * getEntries(): the full-results entries (called when a table is first needed).
 * people: [{ wcaId, name }]. events: the event list ({ id, name, ... }); Multi-Blind is skipped.
 */
export function makeLazyRolling(getEntries, people, events) {
  const sequenceCache = new Map(); // eventId -> Map(wcaId -> sequence)
  const tableCache = new Map(); // `${eventId}|${formatKey}` -> rows

  const table = (event, format) => {
    const key = `${event.id}|${format.key}`;
    if (!tableCache.has(key)) {
      if (!sequenceCache.has(event.id)) sequenceCache.set(event.id, solveSequences(getEntries(), event.id));
      tableCache.set(key, buildRollingRows(people, sequenceCache.get(event.id), event, format));
    }
    return tableCache.get(key);
  };

  return {
    generatedAt: new Date().toISOString(),
    formats: ROLLING_FORMATS.map(({ key, label }) => ({ key, label })),
    events: events
      .filter((e) => e.id !== '333mbf')
      .map((event) => {
        const byFormat = {};
        for (const format of ROLLING_FORMATS) {
          Object.defineProperty(byFormat, format.key, { enumerable: true, get: () => table(event, format) });
        }
        return { id: event.id, name: event.name, byFormat };
      }),
  };
}
