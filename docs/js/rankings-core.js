// Browser port of scripts/build-rankings.js (+ scripts/lib/format.js and scripts/lib/events.js).
// Pure functions, no imports, no DOM: give it people with PBs, get the same
// events / sumOfRanks / kinch structures that rankings.json holds.
//
// KEEP IN SYNC with the Node scripts until the build stops producing rankings.json.
// (EVENTS here is a copy of scripts/lib/events.js, FTO gating included.)

const BASE_EVENTS = [
  { id: '333', name: '3x3x3 Cube', format: 'time' },
  { id: '222', name: '2x2x2 Cube', format: 'time' },
  { id: '444', name: '4x4x4 Cube', format: 'time' },
  { id: '555', name: '5x5x5 Cube', format: 'time' },
  { id: '666', name: '6x6x6 Cube', format: 'time' },
  { id: '777', name: '7x7x7 Cube', format: 'time' },
  { id: '333bf', name: '3x3x3 Blindfolded', format: 'time' },
  { id: '333fm', name: '3x3x3 Fewest Moves', format: 'fmc' },
  { id: '333oh', name: '3x3x3 One-Handed', format: 'time' },
  { id: 'clock', name: 'Clock', format: 'time' },
  { id: 'minx', name: 'Megaminx', format: 'time' },
  { id: 'pyram', name: 'Pyraminx', format: 'time' },
  { id: 'skewb', name: 'Skewb', format: 'time' },
  { id: 'sq1', name: 'Square-1', format: 'time' },
  { id: '444bf', name: '4x4x4 Blindfolded', format: 'time' },
  { id: '555bf', name: '5x5x5 Blindfolded', format: 'time' },
  { id: '333mbf', name: '3x3x3 Multi-Blind', format: 'mbld' },
];
const FTO_FROM = '2027-01-02';
const FTO_EVENT = { id: 'fto', name: 'Face-Turning Octahedron', format: 'time' };

export const SINGLE_ONLY_EVENTS = new Set(['333mbf']);
const KINCH_BEST_OF_EVENTS = new Set(['333bf', '444bf', '555bf', '333fm']);
const KINCH_SINGLE_ONLY_EVENTS = new Set(['333mbf']);

export function activeEvents(now = new Date()) {
  return now.toISOString().slice(0, 10) >= FTO_FROM ? [...BASE_EVENTS, FTO_EVENT] : BASE_EVENTS;
}

// ---------- result formatting (from lib/format.js) ----------

function hasResult(value) {
  return typeof value === 'number' && value > 0;
}

function formatCentiseconds(cs) {
  const minutes = Math.floor(cs / 6000);
  const seconds = Math.floor((cs % 6000) / 100);
  const hundredths = cs % 100;
  const secStr = minutes > 0 ? String(seconds).padStart(2, '0') : String(seconds);
  const hStr = String(hundredths).padStart(2, '0');
  return minutes > 0 ? `${minutes}:${secStr}.${hStr}` : `${secStr}.${hStr}`;
}

function formatFmc(value, isAverage) {
  return isAverage ? (value / 100).toFixed(2) : `${value}`;
}

function decodeMbld(value) {
  if (!hasResult(value)) return null;
  const s = String(value).padStart(10, '0');
  let solved;
  let attempted;
  let seconds;
  if (s[0] === '1') {
    const SS = parseInt(s.slice(1, 3), 10);
    const AA = parseInt(s.slice(3, 5), 10);
    const TTTTT = parseInt(s.slice(5, 10), 10);
    solved = 99 - SS;
    attempted = AA;
    seconds = TTTTT === 99999 ? null : TTTTT;
  } else {
    const DD = parseInt(s.slice(1, 3), 10);
    const TTTTT = parseInt(s.slice(3, 8), 10);
    const MM = parseInt(s.slice(8, 10), 10);
    solved = 99 - DD + MM;
    attempted = solved + MM;
    seconds = TTTTT === 99999 ? null : TTTTT;
  }
  return { solved, attempted, seconds };
}

function formatMbld(value) {
  const d = decodeMbld(value);
  if (!d) return null;
  const { solved, attempted, seconds } = d;
  const h = seconds == null ? null : Math.floor(seconds / 3600);
  const m = seconds == null ? null : Math.floor((seconds % 3600) / 60);
  const sec = seconds == null ? null : seconds % 60;
  const timeStr = seconds == null
    ? '?'
    : h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${m}:${String(sec).padStart(2, '0')}`;
  return `${solved}/${attempted} ${timeStr}`;
}

function mbldKinchRawScore(value) {
  const d = decodeMbld(value);
  if (!d) return null;
  const points = d.solved - (d.attempted - d.solved);
  const fractionLeft = d.seconds == null ? 0 : Math.max(0, (3600 - d.seconds) / 3600);
  return points + fractionLeft;
}

export function formatResult(value, event, isAverage) {
  if (value === -1) return 'DNF';
  if (value === -2) return 'DNS';
  if (!hasResult(value)) return '—';
  if (event.format === 'time') return formatCentiseconds(value);
  if (event.format === 'fmc') return formatFmc(value, isAverage);
  if (event.format === 'mbld') return formatMbld(value) || '—';
  return String(value);
}

// ---------- ranking (from build-rankings.js) ----------

function rankEvent(people, event, type) {
  const withResult = people
    .map((p) => ({ p, value: p.events[event.id]?.[type] }))
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
    ranked.push({
      wcaId: p.wcaId,
      name: p.name,
      rank: place,
      value,
      display: formatResult(value, event, type === 'average'),
      officialRanks: p.events[event.id]?.[type === 'average' ? 'averageRanks' : 'singleRanks'] || null,
    });
    rankByWcaId[p.wcaId] = place;
  });

  const tieRank = withResult.length + 1;
  const hasResultSet = new Set(withResult.map(({ p }) => p.wcaId));
  people.forEach((p) => {
    if (!(p.wcaId in rankByWcaId)) rankByWcaId[p.wcaId] = tieRank;
  });

  return { ranked, rankByWcaId, hasResultSet, bestValue: withResult[0]?.value ?? null };
}

function buildSumOfRanks(people, events, eventRankData, type) {
  const totals = people.map((p) => {
    const components = {};
    let total = 0;
    for (const event of events) {
      const data = eventRankData[event.id][type];
      const r = data.rankByWcaId[p.wcaId];
      components[event.id] = { rank: r, hasResult: data.hasResultSet.has(p.wcaId) };
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

function computeMbldBestRawScore(people) {
  let best = null;
  for (const p of people) {
    const raw = mbldKinchRawScore(p.events['333mbf']?.single);
    if (raw !== null && (best === null || raw > best)) best = raw;
  }
  return best;
}

function mbldScore(bestRawScore, personValue) {
  const raw = mbldKinchRawScore(personValue);
  if (raw === null || !bestRawScore) return null;
  return (raw / bestRawScore) * 100;
}

function buildKinch(people, events, eventRankData) {
  const mbldBestRawScore = computeMbldBestRawScore(people);

  const totals = people.map((p) => {
    const components = {};
    let sum = 0;
    for (const event of events) {
      let score = 0;
      let source = null;

      if (KINCH_SINGLE_ONLY_EVENTS.has(event.id)) {
        const s = event.id === '333mbf'
          ? mbldScore(mbldBestRawScore, p.events[event.id]?.single)
          : eventTypeScore(eventRankData, event.id, 'single', p.events[event.id]?.single);
        if (s !== null) {
          score = s;
          source = 'single';
        }
      } else if (KINCH_BEST_OF_EVENTS.has(event.id)) {
        const single = eventTypeScore(eventRankData, event.id, 'single', p.events[event.id]?.single);
        const average = eventTypeScore(eventRankData, event.id, 'average', p.events[event.id]?.average);
        if (single !== null && (average === null || single >= average)) {
          score = single;
          source = 'single';
        } else if (average !== null) {
          score = average;
          source = 'average';
        }
      } else {
        const s = eventTypeScore(eventRankData, event.id, 'average', p.events[event.id]?.average);
        if (s !== null) {
          score = s;
          source = 'average';
        }
      }

      components[event.id] = { score: Math.round(score * 100) / 100, source };
      sum += score;
    }
    const overall = sum / events.length;
    return { wcaId: p.wcaId, name: p.name, score: Math.round(overall * 100) / 100, components };
  });
  totals.sort((a, b) => b.score - a.score);
  return totals;
}

/**
 * people: [{wcaId, name, countryIso2, events: {eventId: {single, average, singleRanks, averageRanks}}}]
 * (the shape fetch.js writes to results.json). Returns the computed parts of rankings.json.
 */
export function computeRankings(people, events = activeEvents()) {
  const eventRankData = {};
  const eventsOut = [];
  for (const event of events) {
    const single = rankEvent(people, event, 'single');
    const average = rankEvent(people, event, 'average');
    eventRankData[event.id] = { single, average };
    eventsOut.push({
      id: event.id,
      name: event.name,
      hasAverage: !SINGLE_ONLY_EVENTS.has(event.id),
      single: single.ranked,
      average: average.ranked,
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    people: people.map((p) => ({ wcaId: p.wcaId, name: p.name, countryIso2: p.countryIso2 || null })),
    events: eventsOut,
    sumOfRanks: {
      single: buildSumOfRanks(people, events, eventRankData, 'single'),
      average: buildSumOfRanks(people, events, eventRankData, 'average'),
    },
    kinch: { overall: buildKinch(people, events, eventRankData) },
  };
}

// ---------- Parquet rows -> people ----------

/**
 * personRows:  [{wca_id, name, country_id}]            (persons.parquet)
 * singleRows / averageRows: [{wca_id, event_id, best, world_rank, continent_rank, country_rank}]
 * order: wca ids in the order the people should appear (ids not found in persons get an empty entry)
 * displayNames: optional {wcaId: name} that wins over the official name
 */
export function peopleFromRows(personRows, singleRows, averageRows, eventIds, order, displayNames = {}) {
  const byId = new Map();
  for (const r of personRows) {
    byId.set(r.wca_id, {
      wcaId: r.wca_id,
      name: displayNames[r.wca_id] || r.name || r.wca_id,
      countryIso2: null, // Parquet only has the country NAME; see the notes in the test page
      events: {},
    });
  }
  const people = order.map((id) => byId.get(id) || {
    wcaId: id,
    name: displayNames[id] || id,
    countryIso2: null,
    events: {},
    error: 'Not found on the WCA site',
  });
  const index = new Map(people.map((p) => [p.wcaId, p]));

  const apply = (rows, type) => {
    for (const r of rows) {
      if (!eventIds.has(r.event_id)) continue;
      const p = index.get(r.wca_id);
      if (!p) continue;
      const ev = (p.events[r.event_id] ||= { single: null, average: null, singleRanks: null, averageRanks: null });
      ev[type] = r.best ?? null;
      ev[`${type}Ranks`] = {
        world: r.world_rank ?? null,
        continent: r.continent_rank ?? null,
        country: r.country_rank ?? null,
      };
    }
  };
  apply(singleRows, 'single');
  apply(averageRows, 'average');
  return people;
}

// ---------- compare against a built rankings.json ----------

export function diffRankings(mine, built) {
  const res = { compared: 0, mismatches: 0, samples: [], notes: [] };
  const bad = (msg) => {
    res.mismatches += 1;
    if (res.samples.length < 20) res.samples.push(msg);
  };

  const mineIds = new Set(mine.people.map((p) => p.wcaId));
  const builtIds = new Set((built.people || []).map((p) => p.wcaId));
  const common = [...mineIds].filter((id) => builtIds.has(id));
  const onlyMine = [...mineIds].filter((id) => !builtIds.has(id));
  const onlyBuilt = [...builtIds].filter((id) => !mineIds.has(id));
  if (onlyMine.length) res.notes.push(`${onlyMine.length} people only in the browser result: ${onlyMine.slice(0, 5).join(', ')}`);
  if (onlyBuilt.length) res.notes.push(`${onlyBuilt.length} people only in the built file: ${onlyBuilt.slice(0, 5).join(', ')}`);
  if (onlyMine.length || onlyBuilt.length) res.notes.push('The people sets differ, so ranks and totals can differ too.');

  const builtEvents = new Map((built.events || []).map((e) => [e.id, e]));
  for (const ev of mine.events) {
    const b = builtEvents.get(ev.id);
    if (!b) {
      res.notes.push(`Event ${ev.id} is not in the built file`);
      continue;
    }
    for (const type of ['single', 'average']) {
      const a = new Map(ev[type].map((r) => [r.wcaId, r]));
      const c = new Map((b[type] || []).map((r) => [r.wcaId, r]));
      for (const id of common) {
        const ra = a.get(id);
        const rc = c.get(id);
        if (!ra && !rc) continue;
        res.compared += 1;
        if (!ra || !rc) {
          bad(`${ev.id} ${type} ${id}: only in the ${ra ? 'browser result' : 'built file'}`);
        } else if (ra.value !== rc.value) {
          bad(`${ev.id} ${type} ${id}: value ${ra.value} (browser) vs ${rc.value} (built)`);
        } else if (ra.rank !== rc.rank) {
          bad(`${ev.id} ${type} ${id}: rank ${ra.rank} (browser) vs ${rc.rank} (built)`);
        } else if (JSON.stringify(ra.officialRanks) !== JSON.stringify(rc.officialRanks)) {
          bad(`${ev.id} ${type} ${id}: official ranks ${JSON.stringify(ra.officialRanks)} vs ${JSON.stringify(rc.officialRanks)}`);
        }
      }
    }
  }

  for (const type of ['single', 'average']) {
    const a = new Map(mine.sumOfRanks[type].map((r) => [r.wcaId, r.total]));
    const c = new Map(((built.sumOfRanks || {})[type] || []).map((r) => [r.wcaId, r.total]));
    for (const id of common) {
      res.compared += 1;
      if (a.get(id) !== c.get(id)) bad(`Sum of Ranks ${type} ${id}: ${a.get(id)} vs ${c.get(id)}`);
    }
  }

  const ka = new Map(mine.kinch.overall.map((r) => [r.wcaId, r.score]));
  const kc = new Map((((built.kinch || {}).overall) || []).map((r) => [r.wcaId, r.score]));
  for (const id of common) {
    res.compared += 1;
    if (ka.get(id) !== kc.get(id)) bad(`Kinch ${id}: ${ka.get(id)} vs ${kc.get(id)}`);
  }
  return res;
}
