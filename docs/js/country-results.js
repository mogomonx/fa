// Every result of one country, as full-results entries (H2).
//
// A country page (?list=country-au) starts from the ranks files only, which is enough for
// rankings, records, Sum of Ranks and Kinch. The Rolling tab and On This Date / Time frame also
// need every individual result, so main.js loads them with this the first time one is needed
// (about 260,000 rounds for Australia, about 7 MB over the network, well under a second to read).
//
// The entries have the same shape scripts/extract-from-parquet.py writes into full-results.json
// for state and group lists, so compute.js and rolling-core.js treat them the same way:
//   { wcaId, name, eventId, competitionId, competitionName, date, round, roundName, roundRank,
//     pos, single, average, attempts }
// KEEP IN SYNC with extract-from-parquet.py (date, roundName and roundRank rules).
//
// Loaded on demand with a dynamic import inside a try/catch (see main.js), like db.js.

const ISO_RE = /^[A-Z]{2}$/;
const EVENT_RE = /^[a-z0-9]+$/;

// DuckDB hands back a list column (attempts) as an Arrow vector of BigInts, not an array.
function toNumbers(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v.toArray === 'function') return Array.from(v.toArray(), Number);
  const out = [];
  for (const x of v) out.push(Number(x));
  return out;
}

/**
 * country: ISO2 code ('AU'). events: [{ id }] (the page's event list). people: [{ wcaId, name }]
 * (the page's ranked people; their names are used, and anyone else's rows are left out).
 * query: optional replacement for db.js's queryParquet (used by the tests).
 * Returns the entries array.
 */
export async function loadCountryEntries({ country, events, people, query }) {
  const code = String(country || '').toUpperCase();
  if (!ISO_RE.test(code)) throw new Error(`Bad country code: ${country}`);
  const eventIds = (events || []).map((e) => e.id).filter((id) => EVENT_RE.test(String(id)));
  if (!eventIds.length) return [];

  const names = new Map();
  for (const p of people || []) names.set(p.wcaId, p.name);

  const run = query || (await import('./db.js')).queryParquet;
  const t0 = performance.now();
  // results_by_country.parquet is sorted by country, so only this country's row groups are read.
  const rows = await run(
    `SELECT r.wca_id, r.event_id, r.competition_id, r.round_type_id, r.pos, r.best, r.average, r.attempts,
            c.name AS competition_name, r.year, r.month, r.day,
            coalesce(nullif(rt.cell_name, ''), nullif(rt.name, '')) AS round_name,
            rt.rank AS round_rank
     FROM results_by_country.parquet r
     LEFT JOIN competitions.parquet c ON c.id = r.competition_id
     LEFT JOIN round_types.parquet rt ON rt.id = r.round_type_id
     WHERE r.country_iso2 = '${code}' AND r.event_id IN (${eventIds.map((id) => `'${id}'`).join(',')})
     ORDER BY r.result_id`
  );
  const tQuery = performance.now() - t0;

  // The same competition, round and person names repeat on thousands of rows: keep one copy.
  const shared = new Map();
  const share = (s) => {
    if (s == null) return s;
    let v = shared.get(s);
    if (v === undefined) {
      shared.set(s, s);
      v = s;
    }
    return v;
  };

  const entries = [];
  for (const r of rows) {
    const name = names.get(r.wca_id);
    if (name === undefined) continue; // not one of the page's ranked people
    const y = r.year;
    const m = r.month;
    const d = r.day;
    entries.push({
      wcaId: share(r.wca_id),
      name,
      eventId: share(r.event_id),
      competitionId: share(r.competition_id),
      competitionName: share(r.competition_name || r.competition_id),
      date: y && m && d ? share(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`) : null,
      round: share(r.round_type_id),
      roundName: r.round_name ? share(r.round_name) : null,
      roundRank: r.round_rank ?? null,
      pos: r.pos ?? null,
      single: r.best ?? null,
      average: r.average ?? null,
      attempts: toNumbers(r.attempts),
    });
  }
  console.info(
    `Country results for ${code}: ${entries.length} entries (${rows.length} rows read in ${Math.round(tQuery)} ms, ` +
      `${Math.round(performance.now() - t0)} ms in total)`
  );
  return entries;
}
