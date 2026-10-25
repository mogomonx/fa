// Instant rankings (rebuild step 6, flags + lookup pruning added in step 8).
//
// A brand-new list has no built JSON yet (data_level = 'none'). Instead of showing
// "still being built", main.js calls buildInstantData(): it reads the members, queries
// the Parquet files on R2 through db.js (DuckDB-WASM), and computes rankings.json in the
// browser with rankings-core.js. The history files are filled with the same empty
// shapes a "basic" build writes, so every tab behaves exactly as it does for a basic list.
// Once the real build lands (data_level no longer 'none') the page loads the built files.
//
// Always loaded with a dynamic import inside a try/catch (see main.js): if anything here
// fails, the page falls back to the old "still being built" message.

import { activeEvents, peopleFromRows, computeRankings } from './rankings-core.js';

const ID_RE = /^[0-9]{4}[A-Z]{4}[0-9]{2}$/;
const ISO_RE = /^[A-Z]{2}$/;
const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;
// Names are drawn into tables as HTML in places, so strip the characters that could start markup.
const clean = (s) => String(s ?? '').replace(/[<>&]/g, '').trim();

// Up to this many ids go straight into the SQL as a literal list. persons.parquet and
// ranks_*.parquet are sorted by wca_id (step 8), so DuckDB can skip every row group whose
// id range misses the list, which a join against a temp table cannot do in this DuckDB-WASM
// version. Only ids that passed ID_RE are ever put into the SQL. Above the limit (the
// browser crashed at about 12,000 literal ids) a temp table is used instead.
const LITERAL_LIMIT = 1000;

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

  let idFilter;
  if (order.length <= LITERAL_LIMIT) {
    idFilter = `wca_id IN (${order.map(sq).join(',')})`;
  } else {
    await db.queryParquet('CREATE OR REPLACE TEMP TABLE sel_ids (wca_id VARCHAR)');
    for (let i = 0; i < order.length; i += 500) {
      await db.queryParquet(`INSERT INTO sel_ids VALUES ${order.slice(i, i + 500).map((id) => `(${sq(id)})`).join(',')}`);
    }
    idFilter = 'wca_id IN (SELECT wca_id FROM sel_ids)';
  }

  const events = activeEvents();
  const eventIds = new Set(events.map((e) => e.id));
  const evList = [...eventIds].map(sq).join(',');
  const ranksSql = (kind) => `SELECT wca_id, event_id, best, world_rank, continent_rank, country_rank
    FROM ranks_${kind}.parquet WHERE ${idFilter} AND event_id IN (${evList})`;

  // country_iso2 exists in persons.parquet since step 7; an older copy on R2 doesn't have
  // it, so fall back to the old query (no flags) instead of failing the whole page.
  let rawPersons;
  try {
    rawPersons = await db.queryParquet(
      `SELECT wca_id, name, country_id, country_iso2 FROM persons.parquet WHERE ${idFilter}`
    );
  } catch (e) {
    if (!/country_iso2/i.test(String((e && e.message) || e))) throw e;
    console.warn('persons.parquet has no country_iso2 yet; flags will be missing until the build lands.');
    rawPersons = await db.queryParquet(`SELECT wca_id, name, country_id FROM persons.parquet WHERE ${idFilter}`);
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
