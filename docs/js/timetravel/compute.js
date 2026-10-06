// Pure functions: recompute rankings/records from full-results entries
// filtered to a cutoff date. No dependency on app state -- every function
// that needs the event list takes `events` (the live event definitions).
// Mirrors the algorithms the build scripts use server-side.

import { formatDate, formatResultLike, roundLabelFallback } from '../format.js';

const KINCH_BEST_OF_EVENTS = new Set(['333bf', '444bf', '555bf', '333fm']);
const KINCH_SINGLE_ONLY_EVENTS = new Set(['333mbf']);

const hasResult = (v) => typeof v === 'number' && v > 0;

// ---------- Multi-Blind ----------

function decodeMbld(value) {
  if (!hasResult(value)) return null;
  const s = String(value).padStart(10, '0');
  let solved, attempted, seconds;
  if (s[0] === '1') {
    solved = 99 - parseInt(s.slice(1, 3), 10);
    attempted = parseInt(s.slice(3, 5), 10);
    seconds = parseInt(s.slice(5, 10), 10);
  } else {
    const diff = 99 - parseInt(s.slice(1, 3), 10);
    const mm = parseInt(s.slice(8, 10), 10);
    solved = diff + mm;
    attempted = solved + mm;
    seconds = parseInt(s.slice(3, 8), 10);
  }
  return { solved, attempted, seconds };
}

function mbldKinchRawScore(value) {
  const d = decodeMbld(value);
  if (!d) return null;
  const points = d.solved - (d.attempted - d.solved);
  const fractionLeft = d.seconds == null ? 0 : Math.max(0, (3600 - d.seconds) / 3600);
  return points + fractionLeft;
}

// ---------- Snapshot of each person's bests as of the cutoff ----------

function bestFromEntries(entries, wcaId, eventId, type) {
  let best = null;
  for (const e of entries) {
    if (e.wcaId !== wcaId || e.eventId !== eventId) continue;
    if (hasResult(e[type]) && (best === null || e[type] < best)) best = e[type];
  }
  return best;
}

export function buildPeopleSnapshot(events, people, entries) {
  return people.map((p) => {
    const evs = {};
    for (const eventDef of events) {
      evs[eventDef.id] = {
        single: bestFromEntries(entries, p.wcaId, eventDef.id, 'single'),
        average: bestFromEntries(entries, p.wcaId, eventDef.id, 'average'),
      };
    }
    return { wcaId: p.wcaId, name: p.name, countryIso2: p.countryIso2, events: evs };
  });
}

// ---------- Rankings, Sum of Ranks, Kinch ----------

function rankEvent(peopleSnapshot, eventDef, type) {
  const withResult = peopleSnapshot
    .map((p) => ({ p, value: p.events[eventDef.id]?.[type] }))
    .filter(({ value }) => hasResult(value))
    .sort((a, b) => a.value - b.value);
  const ranked = [];
  const rankByWcaId = {};
  let place = 0;
  let lastValue = null;
  withResult.forEach(({ p, value }, i) => {
    if (value !== lastValue) {
      place = i + 1;
      lastValue = value;
    }
    ranked.push({ wcaId: p.wcaId, name: p.name, rank: place, value, display: formatResultLike(value, eventDef, type === 'average') });
    rankByWcaId[p.wcaId] = place;
  });
  // Everyone without a result ties at k+1.
  const tieRank = withResult.length + 1;
  peopleSnapshot.forEach((p) => {
    if (!(p.wcaId in rankByWcaId)) rankByWcaId[p.wcaId] = tieRank;
  });
  return { ranked, rankByWcaId, hasResultSet: new Set(withResult.map(({ p }) => p.wcaId)), bestValue: withResult[0]?.value ?? null };
}

function buildSumOfRanks(events, peopleSnapshot, eventRankData, type) {
  const totals = peopleSnapshot.map((p) => {
    const components = {};
    let total = 0;
    for (const eventDef of events) {
      const data = eventRankData[eventDef.id][type];
      const r = data.rankByWcaId[p.wcaId];
      components[eventDef.id] = { rank: r, hasResult: data.hasResultSet.has(p.wcaId) };
      total += r;
    }
    return { wcaId: p.wcaId, name: p.name, total, components };
  });
  totals.sort((a, b) => a.total - b.total);
  return totals;
}

function eventTypeScore(eventRankData, eventId, type, personValue) {
  const { bestValue } = eventRankData[eventId][type];
  if (!bestValue || !hasResult(personValue)) return null;
  return (bestValue / personValue) * 100;
}

function buildKinch(events, peopleSnapshot, eventRankData) {
  let mbldBest = null;
  for (const p of peopleSnapshot) {
    const raw = mbldKinchRawScore(p.events['333mbf']?.single);
    if (raw !== null && (mbldBest === null || raw > mbldBest)) mbldBest = raw;
  }

  const totals = peopleSnapshot.map((p) => {
    const components = {};
    let sum = 0;
    for (const eventDef of events) {
      let score = 0;
      let source = null;
      const single = p.events[eventDef.id]?.single;
      const average = p.events[eventDef.id]?.average;

      if (KINCH_SINGLE_ONLY_EVENTS.has(eventDef.id)) {
        let s = null;
        if (eventDef.id === '333mbf') {
          const raw = mbldKinchRawScore(single);
          s = raw === null || !mbldBest ? null : (raw / mbldBest) * 100;
        } else {
          s = eventTypeScore(eventRankData, eventDef.id, 'single', single);
        }
        if (s !== null) {
          score = s;
          source = 'single';
        }
      } else if (KINCH_BEST_OF_EVENTS.has(eventDef.id)) {
        const sScore = eventTypeScore(eventRankData, eventDef.id, 'single', single);
        const aScore = eventTypeScore(eventRankData, eventDef.id, 'average', average);
        if (sScore !== null && (aScore === null || sScore >= aScore)) {
          score = sScore;
          source = 'single';
        } else if (aScore !== null) {
          score = aScore;
          source = 'average';
        }
      } else {
        const s = eventTypeScore(eventRankData, eventDef.id, 'average', average);
        if (s !== null) {
          score = s;
          source = 'average';
        }
      }
      components[eventDef.id] = { score: Math.round(score * 100) / 100, source };
      sum += score;
    }
    const overall = sum / events.length;
    return { wcaId: p.wcaId, name: p.name, score: Math.round(overall * 100) / 100, components };
  });
  totals.sort((a, b) => b.score - a.score);
  return totals;
}

export function computeRankingsSnapshot(events, listName, peopleSnapshot, cutoffDate) {
  const eventRankData = {};
  const eventsOut = [];
  for (const eventDef of events) {
    const single = rankEvent(peopleSnapshot, eventDef, 'single');
    const average = rankEvent(peopleSnapshot, eventDef, 'average');
    eventRankData[eventDef.id] = { single, average };
    eventsOut.push({ id: eventDef.id, name: eventDef.name, hasAverage: eventDef.hasAverage, single: single.ranked, average: average.ranked });
  }
  return {
    generatedAt: new Date().toISOString(),
    dataFetchedAt: 'snapshot',
    listName: `${listName || 'FA'} (as of ${formatDate(cutoffDate)})`,
    people: peopleSnapshot.map((p) => ({ wcaId: p.wcaId, name: p.name, countryIso2: p.countryIso2 })),
    events: eventsOut,
    sumOfRanks: {
      single: buildSumOfRanks(events, peopleSnapshot, eventRankData, 'single'),
      average: buildSumOfRanks(events, peopleSnapshot, eventRankData, 'average'),
    },
    kinch: { overall: buildKinch(events, peopleSnapshot, eventRankData) },
  };
}

// ---------- Individual results, Top 100, PR ages ----------

const entryKey = (e) => `${e.wcaId}|${e.competitionId}|${e.round}|${e.attemptIndex ?? 'r'}`;

function poolItem(e, value, attemptIndex, extra = {}) {
  return { wcaId: e.wcaId, name: e.name, competitionId: e.competitionId, competitionName: e.competitionName, round: e.round, date: e.date, value, attemptIndex, ...extra };
}

function buildSinglePool(entries, eventId) {
  const pool = [];
  for (const e of entries) {
    if (e.eventId !== eventId) continue;
    if (e.attempts && e.attempts.length > 0) {
      e.attempts.forEach((v, i) => {
        if (hasResult(v)) pool.push(poolItem(e, v, i + 1));
      });
    } else if (hasResult(e.single)) {
      pool.push(poolItem(e, e.single, null));
    }
  }
  return pool;
}

function buildAveragePool(entries, eventId) {
  return entries
    .filter((e) => e.eventId === eventId && hasResult(e.average))
    .map((e) => poolItem(e, e.average, null, { attempts: e.attempts }));
}

function attemptDisplays(attempts, eventDef) {
  if (!attempts || attempts.length === 0) return null;
  const sortKey = (v) => (v === -1 || v === -2 ? Infinity : v);
  const dropped = new Set();
  if (attempts.length === 5) {
    const sorted = attempts.map((_, i) => i).sort((a, b) => sortKey(attempts[a]) - sortKey(attempts[b]));
    dropped.add(sorted[0]);
    dropped.add(sorted[sorted.length - 1]);
  }
  return attempts.map((v, i) => ({ display: formatResultLike(v, eventDef, false), dropped: dropped.has(i) }));
}

function rankPool(pool, eventDef, type) {
  const byPerson = new Map();
  for (const e of pool) {
    if (!byPerson.has(e.wcaId)) byPerson.set(e.wcaId, []);
    byPerson.get(e.wcaId).push(e);
  }
  const prRankByKey = new Map();
  for (const list of byPerson.values()) {
    list.slice().sort((a, b) => a.value - b.value).forEach((e, i) => prRankByKey.set(entryKey(e), i + 1));
  }
  const ranked = [];
  let place = 0;
  let lastValue = null;
  pool.slice().sort((a, b) => a.value - b.value).forEach((e, i) => {
    if (e.value !== lastValue) {
      place = i + 1;
      lastValue = e.value;
    }
    ranked.push({
      wcaId: e.wcaId,
      name: e.name,
      rank: place,
      prRank: prRankByKey.get(entryKey(e)) || null,
      value: e.value,
      display: formatResultLike(e.value, eventDef, type === 'average'),
      solves: type === 'average' ? attemptDisplays(e.attempts, eventDef) : null,
      competitionName: e.competitionName,
      round: roundLabelFallback(e.round),
      date: e.date,
    });
  });
  return ranked;
}

function buildTop100Tally(ranked) {
  const counts = new Map();
  for (const r of ranked.slice(0, 100)) {
    if (!counts.has(r.wcaId)) counts.set(r.wcaId, { wcaId: r.wcaId, name: r.name, count: 0 });
    counts.get(r.wcaId).count += 1;
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}

// Shared by the Top 100 and FAR-count tables: rows of {wcaId, name, total, components}.
function buildCountTable(events, peopleSnapshot, countsFor) {
  const rows = peopleSnapshot.map((p) => ({ wcaId: p.wcaId, name: p.name, total: 0, components: {} }));
  for (const event of events) {
    const countByWcaId = countsFor(event);
    for (const row of rows) {
      const c = countByWcaId.get(row.wcaId) || 0;
      row.components[event.id] = c;
      row.total += c;
    }
  }
  rows.sort((a, b) => b.total - a.total);
  return rows;
}

function findBreakdown(entries, wcaId, eventId, value, type, eventDef) {
  if (!hasResult(value)) return null;
  const match = entries.find((e) => e.wcaId === wcaId && e.eventId === eventId && e[type] === value);
  if (!match) return null;
  const result = { competitionName: match.competitionName, round: roundLabelFallback(match.round), date: match.date };
  if (type === 'average' && match.attempts) result.solves = attemptDisplays(match.attempts, eventDef);
  return result;
}

export function computeIndividualSnapshot(events, entries, peopleSnapshot) {
  const eventsOut = [];
  for (const eventDef of events) {
    const singleRanked = rankPool(buildSinglePool(entries, eventDef.id), eventDef, 'single');
    const averageRanked = rankPool(buildAveragePool(entries, eventDef.id), eventDef, 'average');
    eventsOut.push({
      id: eventDef.id,
      name: eventDef.name,
      single: { ranked: singleRanked, top100Tally: buildTop100Tally(singleRanked) },
      average: averageRanked.length ? { ranked: averageRanked, top100Tally: buildTop100Tally(averageRanked) } : null,
    });
  }

  const breakdowns = {};
  const prAges = [];
  for (const p of peopleSnapshot) {
    breakdowns[p.wcaId] = {};
    for (const eventDef of events) {
      const singleValue = p.events[eventDef.id]?.single;
      const averageValue = p.events[eventDef.id]?.average;
      const single = findBreakdown(entries, p.wcaId, eventDef.id, singleValue, 'single', eventDef);
      const average = findBreakdown(entries, p.wcaId, eventDef.id, averageValue, 'average', eventDef);
      if (single || average) breakdowns[p.wcaId][eventDef.id] = { single, average };
      const base = { wcaId: p.wcaId, name: p.name, eventId: eventDef.id, eventName: eventDef.name };
      if (single) prAges.push({ ...base, type: 'single', value: singleValue, display: formatResultLike(singleValue, eventDef, false), date: single.date });
      if (average) prAges.push({ ...base, type: 'average', value: averageValue, display: formatResultLike(averageValue, eventDef, true), date: average.date });
    }
  }
  prAges.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));

  const top100For = (type) =>
    buildCountTable(eventsOut, peopleSnapshot, (event) => new Map((event[type] ? event[type].top100Tally : []).map((t) => [t.wcaId, t.count])));

  return {
    generatedAt: new Date().toISOString(),
    events: eventsOut,
    breakdowns,
    prAges,
    top100: { single: top100For('single'), average: top100For('average') },
  };
}

// ---------- Historical records ----------

function computeHistory(entries, eventDef, type) {
  const relevant = entries
    .filter((e) => e.eventId === eventDef.id && hasResult(e[type]))
    .slice()
    .sort((a, b) => (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99'));
  const history = [];
  let bestSoFar = null;
  for (const e of relevant) {
    if (bestSoFar === null || e[type] < bestSoFar) {
      bestSoFar = e[type];
      history.push({
        eventId: eventDef.id,
        eventName: eventDef.name,
        type,
        wcaId: e.wcaId,
        name: e.name,
        value: e[type],
        display: formatResultLike(e[type], eventDef, type === 'average'),
        competitionName: e.competitionName,
        round: roundLabelFallback(e.round),
        date: e.date,
      });
    }
  }
  return history;
}

export function computeHistoricalSnapshot(events, entries, peopleSnapshot) {
  const allRecords = [];
  for (const eventDef of events) {
    allRecords.push(...computeHistory(entries, eventDef, 'single'));
    allRecords.push(...computeHistory(entries, eventDef, 'average'));
  }
  const currentRecords = [];
  for (const eventDef of events) {
    for (const type of ['single', 'average']) {
      const h = allRecords.filter((r) => r.eventId === eventDef.id && r.type === type);
      if (h.length > 0) currentRecords.push(h[h.length - 1]);
    }
  }
  allRecords.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  currentRecords.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const farFor = (type) =>
    buildCountTable(events, peopleSnapshot, (event) => {
      const m = new Map();
      for (const r of allRecords) {
        if (r.eventId === event.id && r.type === type) m.set(r.wcaId, (m.get(r.wcaId) || 0) + 1);
      }
      return m;
    });

  return {
    generatedAt: new Date().toISOString(),
    records: allRecords,
    currentRecordsByAge: currentRecords,
    farCounts: { single: farFor('single'), average: farFor('average') },
  };
}

// ---------- PR streaks (primary cross-event metric only) ----------

function walkStreak(points) {
  let best = 0;
  let running = 0;
  let runningStartName = null;
  let bestStartName = null;
  let bestEndName = null;
  for (const point of points) {
    if (point.isPr) {
      if (running === 0) runningStartName = point.name;
      running += 1;
      if (running > best) {
        best = running;
        bestStartName = runningStartName;
        bestEndName = point.name;
      }
    } else {
      running = 0;
      runningStartName = null;
    }
  }
  const bestIsOngoing = best > 0 && best === running;
  return {
    current: running,
    currentRange: running > 0 ? { start: runningStartName, end: 'Current' } : null,
    best,
    bestRange: best > 0 ? { start: bestStartName, end: bestIsOngoing ? 'Current' : bestEndName } : null,
  };
}

function overallCompetitionStreak(entries, wcaId) {
  const own = entries.filter((e) => e.wcaId === wcaId);
  const compInfo = new Map();
  for (const e of own) {
    if (!compInfo.has(e.competitionId)) compInfo.set(e.competitionId, { date: e.date, name: e.competitionName || e.competitionId });
  }
  const compIds = Array.from(compInfo.keys()).sort((a, b) => (compInfo.get(a).date || '9999').localeCompare(compInfo.get(b).date || '9999'));
  const bestSoFar = new Map();
  const points = [];
  for (const compId of compIds) {
    const byEventType = new Map();
    for (const e of own.filter((x) => x.competitionId === compId)) {
      for (const type of ['single', 'average']) {
        if (!hasResult(e[type])) continue;
        const key = `${e.eventId}|${type}`;
        if (!byEventType.has(key) || e[type] < byEventType.get(key)) byEventType.set(key, e[type]);
      }
    }
    let isPr = false;
    for (const [key, value] of byEventType) {
      const prev = bestSoFar.has(key) ? bestSoFar.get(key) : null;
      if (prev === null || value < prev) {
        isPr = true;
        bestSoFar.set(key, value);
      }
    }
    points.push({ isPr, name: compInfo.get(compId).name });
  }
  return walkStreak(points);
}

export function computeStreaksSnapshot(events, entries, peopleSnapshot) {
  return {
    generatedAt: new Date().toISOString(),
    overall: peopleSnapshot.map((p) => ({ wcaId: p.wcaId, name: p.name, streak: overallCompetitionStreak(entries, p.wcaId) })),
    events: events.map((e) => ({ id: e.id, name: e.name })),
    byEvent: {}, // round-level side panel isn't covered by time travel (known gap)
  };
}
