// Instant rankings (rebuild step 6; flags + per-person lookups added in step 8).
//
// A brand-new list has no built JSON yet (data_level = 'none'). Instead of showing
// "still being built", main.js calls buildInstantData(): it reads the members, queries
// the Parquet files on R2 through db.js (DuckDB-WASM), and computes rankings.json in the
// browser with rankings-core.js. The history files are filled with the same empty
// shapes a "basic" build writes, so every tab behaves exactly as it does for a basic list.
// Once the real build lands (data_level no longer 'none') the page loads the built files.
//
// buildCountryData() (H1) does the same for a whole country (?list=country-au): no member
// list, everyone of that nationality.
//
// Always loaded with a dynamic import inside a try/catch (see main.js): if anything here
// fails, the page falls back to the old "still being built" message.

import { activeEvents, peopleFromRows, computeRankings } from './rankings-core.js';

const ID_RE = /^[0-9]{4}[A-Z]{4}[0-9]{2}$/;
const ISO_RE = /^[A-Z]{2}$/;
const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;
// The tables escape names when they draw them (session 19); this is a second layer that
// removes the characters that could start markup (< > ") and control characters.
// Keep in step with is_safe_name() in supabase/schema.sql. An "&" is fine now.
const clean = (s) => String(s ?? '').replace(/[<>"\u0000-\u001f\u007f]/g, '').trim();

// Up to this many ids are looked up one by one with `wca_id = '...'` (UNION ALL of one
// small SELECT per person). persons.parquet and ranks_*.parquet are sorted by wca_id
// (step 8) and an equality filter lets DuckDB skip every row group whose min/max range
// misses that id. A single `IN (...)` list did NOT do this in the first test (26.8 MB read,
// slightly MORE than before): it only narrows to the lowest-to-highest id, which for a
// list spread over 2015-2025 is nearly the whole file. Only ids that passed ID_RE are ever
// put into the SQL. Above the limit a temp table is used instead.
const LOOKUP_LIMIT = 200;

// Members of the list: normally readable through the table (the viewer's permissions
// decide); a guest list made in this browser is read with its edit token instead.
async function loadMembers({ supabase, list, listId }) {
  if (!list.owner_id && list.kind === 'group') {
    try {
      const g = JSON.parse(localStorage.getItem('fa-guest-list') || 'null');
      if (g && g.slug === list.slug) {
        const { data, error } = await supabase.rpc('get_guest_list', { p_slug: g.slug, p_token: g.token });
        if (!error && data && data.members) return data.members;
      }
    } catch (e) {
      // fall through to the table read
    }
  }
  const { data, error } = await supabase
    .from('list_members').select('wca_id, display_name').eq('list_id', listId).order('added_at');
  if (error) throw error;
  return data || [];
}

function zeroRows(people, events) {
  return people.map((p) => ({
    wcaId: p.wcaId,
    name: p.name,
    total: 0,
    components: Object.fromEntries(events.map((e) => [e.id, 0])),
  }));
}

// Same shape build-individual-rankings.js writes when there are no results.
function emptyIndividual(people, events) {
  return {
    generatedAt: new Date().toISOString(),
    events: events.map((e) => ({
      id: e.id,
      name: e.name,
      single: { ranked: [], top100: { tally: [], consideredCount: 0, cutoffValue: null, cutoffDisplay: null } },
      average: null,
    })),
    breakdowns: Object.fromEntries(people.map((p) => [p.wcaId, {}])),
    prAges: [],
    top100: { single: zeroRows(people, events), average: zeroRows(people, events) },
  };
}

// Same shape build-historical-records.js writes when there are no results.
function emptyHistorical(people, events) {
  return {
    generatedAt: new Date().toISOString(),
    records: [],
    currentRecordsByAge: [],
    farCounts: { single: zeroRows(people, events), average: zeroRows(people, events) },
  };
}

/**
 * source = { supabase, listId, list } (what main.js resolveSource() builds).
 * Returns { rankings, individual, historical, ms }, or null when it can't be done
 * (no members readable).
 */
export async function buildInstantData(source) {
  const t0 = performance.now();
  const members = await loadMembers(source);
  const order = [...new Set(members.map((m) => m.wca_id).filter((id) => ID_RE.test(id)))];
  if (!order.length) return null;

  const displayNames = {};
  for (const m of members) if (m.display_name) displayNames[m.wca_id] = clean(m.display_name);

  const db = await import('./db.js');
  await db.initDB();
  // Each person is a separate small read, so ask DuckDB to remember every file's footer
  // (row group ranges) instead of fetching it again for every lookup. Harmless if the
  // setting doesn't exist in this DuckDB-WASM version.
  try {
    await db.queryParquet('SET enable_object_cache = true');
  } catch (e) {
    console.warn('Could not enable the object cache:', e);
  }

  const useTemp = order.length > LOOKUP_LIMIT;
  if (useTemp) {
    await db.queryParquet('CREATE OR REPLACE TEMP TABLE sel_ids (wca_id VARCHAR)');
    for (let i = 0; i < order.length; i += 500) {
      await db.queryParquet(`INSERT INTO sel_ids VALUES ${order.slice(i, i + 500).map((id) => `(${sq(id)})`).join(',')}`);
    }
  }
  // SQL that returns `cols` from `table` for exactly the list's people (plus an optional extra condition).
  const lookup = (cols, table, extra = '') =>
    useTemp
      ? `SELECT ${cols} FROM ${table} WHERE wca_id IN (SELECT wca_id FROM sel_ids)${extra}`
      : order.map((id) => `SELECT ${cols} FROM ${table} WHERE wca_id = ${sq(id)}${extra}`).join(' UNION ALL ');

  const events = activeEvents();
  const eventIds = new Set(events.map((e) => e.id));
  const evList = [...eventIds].map(sq).join(',');
  const ranksSql = (kind) =>
    lookup('wca_id, event_id, best, world_rank, continent_rank, country_rank', `ranks_${kind}.parquet`, ` AND event_id IN (${evList})`);

  // country_iso2 exists in persons.parquet since step 7; an older copy on R2 doesn't have
  // it, so fall back to the old query (no flags) instead of failing the whole page.
  let rawPersons;
  try {
    rawPersons = await db.queryParquet(lookup('wca_id, name, country_id, country_iso2', 'persons.parquet'));
  } catch (e) {
    if (!/country_iso2/i.test(String((e && e.message) || e))) throw e;
    console.warn('persons.parquet has no country_iso2 yet; flags will be missing until the build lands.');
    rawPersons = await db.queryParquet(lookup('wca_id, name, country_id', 'persons.parquet'));
  }
  const isoById = {};
  for (const r of rawPersons) {
    const iso = String(r.country_iso2 ?? '').trim().toUpperCase();
    if (ISO_RE.test(iso)) isoById[r.wca_id] = iso;
  }
  const personRows = rawPersons.map((r) => ({ ...r, name: clean(r.name) }));
  const singleRows = await db.queryParquet(ranksSql('single'));
  const averageRows = await db.queryParquet(ranksSql('average'));

  const people = peopleFromRows(personRows, singleRows, averageRows, eventIds, order, displayNames);
  // Flags: set on the input people AND on the output rows, so it works whichever of the two
  // rankings-core.js copies across.
  for (const p of people) if (p && isoById[p.wcaId]) p.countryIso2 = isoById[p.wcaId];
  const rankings = computeRankings(people, events);
  for (const row of rankings.people || []) {
    if (!row.countryIso2 && isoById[row.wcaId]) row.countryIso2 = isoById[row.wcaId];
  }
  rankings.dataFetchedAt = rankings.generatedAt;
  rankings.listName = source.list.name;

  return {
    rankings,
    individual: emptyIndividual(people, events),
    historical: emptyHistorical(people, events),
    ms: performance.now() - t0,
  };
}

/**
 * Whole-country rankings (H1, the Australia page).
 *
 * source = { list: { country: 'AU', name: 'Australia' } } (what main.js resolveSource() builds
 * for ?list=country-au). There is no member list: everyone whose WCA country is `country` and
 * who has at least one official single or average is ranked. Returns the same
 * { rankings, individual, historical, ms } as buildInstantData, with empty history shapes
 * (no results are read), or null for a bad country code.
 *
 * Two routes to the data:
 *   1. ranks_single_by_country.parquet / ranks_average_by_country.parquet (converter v8.5):
 *      sorted by country, so only that country's row groups are read, and they carry the
 *      name, so persons.parquet is not read at all. About 1 MB per file for Australia.
 *   2. Until those files exist on R2 (or if reading them fails): persons.parquet filtered by
 *      country, then the two whole ranks files filtered by those ids. Reads about 27 MB.
 */
export async function buildCountryData(source) {
  const t0 = performance.now();
  const code = String((source.list && source.list.country) || '').toUpperCase();
  if (!ISO_RE.test(code)) return null;

  const laps = [];
  const lap = (step) => laps.push({ step, at_ms: Math.round(performance.now() - t0) });

  const db = await import('./db.js');
  await db.initDB();
  try {
    await db.queryParquet('SET enable_object_cache = true');
  } catch (e) {
    console.warn('Could not enable the object cache:', e);
  }
  lap('DuckDB ready');

  const events = activeEvents();
  const eventIds = new Set(events.map((e) => e.id));
  const evList = [...eventIds].map(sq).join(',');

  let singleRows;
  let averageRows;
  let personRows;
  let route;

  try {
    const byCountry = (kind) =>
      `SELECT wca_id, name, event_id, best, world_rank, continent_rank, country_rank
       FROM ranks_${kind}_by_country.parquet
       WHERE country_iso2 = ${sq(code)} AND event_id IN (${evList})`;
    singleRows = await db.queryParquet(byCountry('single'));
    lap(`ranks_single_by_country read (${singleRows.length} rows)`);
    averageRows = await db.queryParquet(byCountry('average'));
    lap(`ranks_average_by_country read (${averageRows.length} rows)`);

    // Names come with the rows: one entry per person who has at least one official result.
    const names = new Map();
    for (const r of singleRows) if (!names.has(r.wca_id)) names.set(r.wca_id, r.name);
    for (const r of averageRows) if (!names.has(r.wca_id)) names.set(r.wca_id, r.name);
    personRows = [];
    for (const [wca_id, name] of names) {
      if (ID_RE.test(String(wca_id))) personRows.push({ wca_id, name: clean(name) });
    }
    route = 'by_country files';
  } catch (e) {
    console.warn('The by-country ranks files are not available yet; using the slower route:', e);

    // Everyone of this nationality, once, in a temp table the two ranks queries filter by.
    await db.queryParquet(
      `CREATE OR REPLACE TEMP TABLE scope_persons AS
       SELECT wca_id, name, country_id, country_iso2 FROM persons.parquet WHERE country_iso2 = ${sq(code)}`
    );
    lap('persons read');
    const ranksSql = (kind) =>
      `SELECT r.wca_id, r.event_id, r.best, r.world_rank, r.continent_rank, r.country_rank
       FROM ranks_${kind}.parquet r
       WHERE r.event_id IN (${evList}) AND r.wca_id IN (SELECT wca_id FROM scope_persons)`;
    singleRows = await db.queryParquet(ranksSql('single'));
    lap(`ranks_single read (${singleRows.length} rows)`);
    averageRows = await db.queryParquet(ranksSql('average'));
    lap(`ranks_average read (${averageRows.length} rows)`);
    const rawPersons = await db.queryParquet('SELECT wca_id, name, country_id, country_iso2 FROM scope_persons');

    // Only people with at least one official result are ranked.
    const hasRank = new Set();
    for (const r of singleRows) hasRank.add(r.wca_id);
    for (const r of averageRows) hasRank.add(r.wca_id);
    personRows = rawPersons
      .filter((r) => ID_RE.test(String(r.wca_id)) && hasRank.has(r.wca_id))
      .map((r) => ({ ...r, name: clean(r.name) }));
    route = 'whole files (fallback)';
  }

  const order = personRows.map((r) => r.wca_id).sort();
  const people = peopleFromRows(personRows, singleRows, averageRows, eventIds, order);
  for (const p of people) p.countryIso2 = code;
  lap(`${people.length} people built`);

  const rankings = computeRankings(people, events);
  for (const row of rankings.people || []) row.countryIso2 = code;
  rankings.dataFetchedAt = rankings.generatedAt;
  rankings.listName = source.list.name;
  lap('rankings computed');

  console.info(`Country rankings for ${code}: ${people.length} people (route: ${route})`);
  console.table(laps);

  return {
    rankings,
    individual: emptyIndividual([], events),
    historical: emptyHistorical([], events),
    ms: performance.now() - t0,
  };
}
