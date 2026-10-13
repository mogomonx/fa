// Builds region ("state") ranking datasets from the WCA results export.
//
//   node scripts/build-states.js <export-dir> <country> [country ...]     e.g.  ... /tmp/wca-export AU
//
// Reads build/states-input.json (written by sync-lists.js: the state lists,
// everyone's region overrides and "everywhere" preferred names) and writes
// build/data/<slug>/results.json for every state list, in exactly the shape
// scripts/fetch.js writes for a normal list. The workflow then runs the usual
// build-rankings.js etc. on each state slug, so state lists reuse the whole
// rankings page.
//
// Who is in a state list, in order:
//   1. An override row for the person (their own choice or an admin's):
//      hidden = left out; otherwise that region (works for anyone, any WCA country).
//   2. Otherwise, if their WCA country is one we build: the region they
//      compete in most. Competitions (not rounds) are counted, only in the
//      last RECENT_YEARS years; if that gives no region with at least
//      MIN_COMPS competitions, all time is used. Ties go to the region of the
//      most recent competition. No region qualifies = left out.
// People with no official result at all are left out of the lists.
//
// Region of a competition = parsed from the export's city text ("Sydney, New
// South Wales"). Competitions that can't be read are listed in the log.
// Any missing file or column stops the script (nothing is published).

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { EVENTS } = require('./lib/events');
const { getListContext } = require('./lib/list-context');

const EVENT_IDS = new Set(EVENTS.map((e) => e.id));
const BUILD_ROOT = path.resolve(__dirname, '..', process.env.LISTS_ROOT || 'build');
const RECENT_YEARS = 3;
const MIN_COMPS = 2;

// To add a country later: add an entry here (and extend valid_region() in SQL).
const COUNTRIES = {
  AU: {
    regions: [
      { code: 'NSW', names: ['new south wales', 'nsw', 'n.s.w.'] },
      { code: 'VIC', names: ['victoria', 'vic'] },
      { code: 'QLD', names: ['queensland', 'qld'] },
      { code: 'WA', names: ['western australia', 'wa'] },
      { code: 'SA', names: ['south australia', 'sa'] },
      { code: 'TAS', names: ['tasmania', 'tas'] },
      { code: 'ACT', names: ['australian capital territory', 'act', 'a.c.t.'] },
      { code: 'NT', names: ['northern territory', 'nt'] },
    ],
    // Only used when the state can't be read from the city text.
    cities: {
      sydney: 'NSW', newcastle: 'NSW', wollongong: 'NSW',
      melbourne: 'VIC', geelong: 'VIC',
      brisbane: 'QLD', 'gold coast': 'QLD', cairns: 'QLD', townsville: 'QLD',
      perth: 'WA', adelaide: 'SA', hobart: 'TAS', launceston: 'TAS',
      canberra: 'ACT', darwin: 'NT',
    },
  },
};
for (const def of Object.values(COUNTRIES)) {
  def.lookup = new Map();
  for (const r of def.regions) for (const n of r.names) def.lookup.set(n, r.code);
  def.cityMap = new Map(Object.entries(def.cities));
  def.codes = new Set(def.regions.map((r) => r.code));
}

function findFile(dir, re) {
  const match = fs.readdirSync(dir).find((f) => re.test(f));
  return match ? path.join(dir, match) : null;
}
function need(dir, re, label) {
  const f = findFile(dir, re);
  if (!f) throw new Error(`Could not find ${label} in the export. Files: ${fs.readdirSync(dir).join(', ')}`);
  return f;
}
const pad = (n) => String(n).padStart(2, '0');
function toNum(v) {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// Streams a TSV. fields = { key: [possible header names] }; `required` keys must
// exist or the script stops with the actual header shown.
async function scanTsv(file, fields, required, onRow) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let idx = null;
  const keys = Object.keys(fields);
  for await (const line of rl) {
    if (!line) continue;
    const cols = line.split('\t');
    if (!idx) {
      idx = {};
      for (const k of keys) idx[k] = cols.findIndex((c) => fields[k].includes(c));
      const missing = required.filter((k) => idx[k] < 0);
      if (missing.length) {
        throw new Error(`${path.basename(file)} has no column for: ${missing.join(', ')}. Header was: ${cols.join(', ')}`);
      }
      continue;
    }
    const row = {};
    for (const k of keys) row[k] = idx[k] >= 0 ? cols[idx[k]] : undefined;
    onRow(row);
  }
}

// country text/ID in the export -> ISO2 ("Australia" or "AU" -> "AU")
const countryMap = new Map([['australia', 'AU']]);
function toIso(raw) {
  const k = String(raw || '').trim().toLowerCase();
  if (!k) return null;
  return countryMap.get(k) || (k.length === 2 ? k.toUpperCase() : null);
}

function regionOf(city, def) {
  const parts = String(city || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const hit = def.lookup.get(parts[i]);
    if (hit) return hit;
  }
  for (const part of parts) { // "Perth WA"
    const tokens = part.split(/\s+/);
    const hit = def.lookup.get(tokens[tokens.length - 1]);
    if (hit) return hit;
  }
  for (const part of parts) {
    const hit = def.cityMap.get(part);
    if (hit) return hit;
  }
  return null;
}

// entries: [{region, date}] -> region with most competitions (>= MIN_COMPS); tie = most recent
function pickRegion(entries) {
  const tally = new Map();
  for (const { region, date } of entries) {
    const t = tally.get(region) || { n: 0, last: '' };
    t.n += 1;
    if (date > t.last) t.last = date;
    tally.set(region, t);
  }
  let best = null;
  for (const [region, t] of tally) {
    if (t.n < MIN_COMPS) continue;
    if (!best || t.n > best.n || (t.n === best.n && t.last > best.last)) best = { region, n: t.n, last: t.last };
  }
  return best ? best.region : null;
}

async function main() {
  const [exportDir, ...countries] = process.argv.slice(2);
  if (!exportDir || !countries.length) {
    console.error('Usage: node scripts/build-states.js <export-dir> <country> [country ...]');
    process.exit(1);
  }
  for (const c of countries) if (!COUNTRIES[c]) throw new Error(`No region setup for country ${c}`);
  const wanted = new Set(countries);

  const input = JSON.parse(fs.readFileSync(path.join(BUILD_ROOT, 'states-input.json'), 'utf8'));
  const overrides = new Map((input.overrides || []).map((o) => [o.wca_id, o]));
  const names = input.names || {};
  console.log(`Building ${input.lists.length} state list(s) for ${countries.join(', ')}; ${overrides.size} override(s).`);

  // countries.tsv (optional): id/name -> ISO2
  const countriesFile = findFile(exportDir, /(^|_)countries\.tsv$/i);
  if (countriesFile) {
    await scanTsv(countriesFile, { id: ['id'], name: ['name'], iso2: ['iso2'] }, ['id', 'iso2'], (row) => {
      const iso = String(row.iso2 || '').toUpperCase();
      if (!iso) return;
      countryMap.set(String(row.id).toLowerCase(), iso);
      if (row.name) countryMap.set(String(row.name).toLowerCase(), iso);
    });
  } else {
    console.log('  (no countries.tsv; only "Australia"/"AU" will be recognised)');
  }

  // People: current row only (sub_id 1); keep people of the wanted countries + override people
  const persons = new Map();
  await scanTsv(need(exportDir, /(^|_)persons\.tsv$/i, 'persons.tsv'),
    { id: ['wca_id', 'id', 'wcaId'], sub: ['sub_id', 'subid', 'subId'], name: ['name'], country: ['country_id', 'countryId', 'country'] },
    ['id', 'name', 'country'], (row) => {
      if (row.sub !== undefined && row.sub !== '1') return;
      const iso = toIso(row.country);
      if (wanted.has(iso) || overrides.has(row.id)) persons.set(row.id, { name: row.name, iso });
    });
  const wcaCountryPeople = [...persons.values()].filter((p) => wanted.has(p.iso)).length;
  console.log(`People: ${wcaCountryPeople} with a WCA country we build, ${persons.size} including override people.`);
  if (!wcaCountryPeople) throw new Error('Found no people for the requested countries; check the persons.tsv country column.');

  // Competitions in those countries -> region + date
  const comps = new Map();
  const unmapped = [];
  let countryComps = 0;
  await scanTsv(need(exportDir, /(^|_)competitions\.tsv$/i, 'competitions.tsv'),
    { id: ['id'], name: ['name'], city: ['city_name', 'cityName'], country: ['country_id', 'countryId'], year: ['year'], month: ['month'], day: ['day'] },
    ['id', 'city', 'country'], (row) => {
      const iso = toIso(row.country);
      if (!wanted.has(iso)) return;
      countryComps += 1;
      const region = regionOf(row.city, COUNTRIES[iso]);
      if (!region) { unmapped.push(`${row.name || row.id} [${row.city}]`); return; }
      const date = row.year && row.month && row.day ? `${row.year}-${pad(row.month)}-${pad(row.day)}` : '';
      comps.set(row.id, { country: iso, region, date });
    });
  console.log(`Competitions: ${countryComps} in the requested countries, ${comps.size} mapped to a region, ${unmapped.length} could not be mapped.`);
  if (unmapped.length) {
    console.log('  Could not map (first 40):');
    for (const u of unmapped.slice(0, 40)) console.log(`    ${u}`);
  }
  if (!comps.size) throw new Error('No competitions could be mapped to a region; check the competitions.tsv city column.');

  // Which mapped competitions each person attended (one pass over the big file)
  const compsByPerson = new Map();
  await scanTsv(need(exportDir, /(^|_)results\.tsv$/i, 'results.tsv'),
    { person: ['person_id', 'personId', 'wca_id'], comp: ['competition_id', 'competitionId'] },
    ['person', 'comp'], (row) => {
      if (!persons.has(row.person)) return;
      const c = comps.get(row.comp);
      if (!c) return;
      let m = compsByPerson.get(row.person);
      if (!m) { m = new Map(); compsByPerson.set(row.person, m); }
      m.set(row.comp, c);
    });

  // Decide each person's region
  const cut = new Date();
  cut.setFullYear(cut.getFullYear() - RECENT_YEARS);
  const cutoff = cut.toISOString().slice(0, 10);
  const final = new Map(); // wcaId -> {country, region}
  const stats = { override: 0, autoRecent: 0, autoAll: 0, hidden: 0, noRegionWithComps: 0, noRegionNoComps: 0 };
  for (const [wcaId, p] of persons) {
    const o = overrides.get(wcaId);
    if (o) {
      if (o.hidden) { stats.hidden += 1; continue; }
      if (o.region) {
        if (!wanted.has(o.country)) continue; // belongs to another country's lists
        if (!COUNTRIES[o.country].codes.has(o.region)) { console.warn(`  ${wcaId}: override region ${o.region} is not valid, ignoring`); continue; }
        final.set(wcaId, { country: o.country, region: o.region });
        stats.override += 1;
        continue;
      }
    }
    if (!wanted.has(p.iso)) continue;
    const entries = [...(compsByPerson.get(wcaId)?.values() || [])].filter((c) => c.country === p.iso);
    const recent = entries.filter((c) => c.date >= cutoff);
    let region = pickRegion(recent);
    if (region) stats.autoRecent += 1;
    else { region = pickRegion(entries); if (region) stats.autoAll += 1; }
    if (region) final.set(wcaId, { country: p.iso, region });
    else if (entries.length) stats.noRegionWithComps += 1;
    else stats.noRegionNoComps += 1;
  }
  console.log(`Assigned ${final.size}: ${stats.override} by override, ${stats.autoRecent} auto (last ${RECENT_YEARS} years), ${stats.autoAll} auto (all time). ` +
    `Left out: ${stats.hidden} hidden, ${stats.noRegionWithComps} with competitions but no region reaching ${MIN_COMPS}, ${stats.noRegionNoComps} with no mapped competitions.`);

  // Official PBs + ranks for those people
  const blank = () => Object.fromEntries([...EVENT_IDS].map((id) => [id, { single: null, average: null, singleRanks: null, averageRanks: null }]));
  const members = new Map();
  for (const [wcaId] of final) {
    const p = persons.get(wcaId);
    members.set(wcaId, { wcaId, name: names[wcaId] || p.name || wcaId, countryIso2: p.iso || null, events: blank() });
  }
  async function loadRanks(file, type) {
    await scanTsv(file,
      { person: ['person_id', 'personId'], event: ['event_id', 'eventId'], best: ['best'], world: ['world_rank', 'worldRank'], continent: ['continent_rank', 'continentRank'], country: ['country_rank', 'countryRank'] },
      ['person', 'event', 'best'], (row) => {
        const m = members.get(row.person);
        if (!m || !EVENT_IDS.has(row.event)) return;
        const ev = m.events[row.event];
        ev[type] = toNum(row.best);
        ev[`${type}Ranks`] = { world: toNum(row.world), continent: toNum(row.continent), country: toNum(row.country) };
      });
  }
  await loadRanks(need(exportDir, /(^|_)ranks_single\.tsv$/i, 'ranks_single.tsv'), 'single');
  await loadRanks(need(exportDir, /(^|_)ranks_average\.tsv$/i, 'ranks_average.tsv'), 'average');

  const byList = new Map(input.lists.map((l) => [`${l.country}/${l.region}`, []]));
  let noResults = 0;
  for (const [wcaId, m] of members) {
    if (!Object.values(m.events).some((e) => e.single !== null || e.average !== null)) { noResults += 1; continue; }
    const key = `${final.get(wcaId).country}/${final.get(wcaId).region}`;
    if (!byList.has(key)) { console.warn(`  ${wcaId}: there is no state list for ${key}`); continue; }
    byList.get(key).push(m);
  }
  console.log(`Left out ${noResults} people with no official result.`);

  let total = 0;
  for (const l of input.lists) {
    if (!wanted.has(l.country)) continue;
    const people = byList.get(`${l.country}/${l.region}`).sort((a, b) => a.name.localeCompare(b.name));
    const ctx = getListContext(l.slug);
    fs.mkdirSync(ctx.dataDir, { recursive: true });
    fs.writeFileSync(path.join(ctx.dataDir, 'results.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), people }));
    console.log(`  ${l.slug}: ${people.length} people`);
    total += people.length;
  }
  if (!total) throw new Error('No people ended up in any state list; stopping so nothing empty is published.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
