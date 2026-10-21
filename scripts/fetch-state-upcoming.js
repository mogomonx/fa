// Upcoming WCA competitions held in each state list's region.
//
//   node scripts/fetch-state-upcoming.js state-slug [state-slug ...]
//
// State lists have no members, so there is nothing to match registrants against:
// this just lists the competitions that take place inside the state (the same
// city-text matching build-states.js uses to decide a competition's state).
//
// Reads build/states-input.json (written by sync-lists.js --all or --pending) and
// writes build/data/<slug>/upcoming.json with kind: 'state' (no attendees).
// If any request fails after the retries, NOTHING is written and the step exits 1,
// so the previous upcoming.json in Storage is left alone.
//
// The retry helper below is a copy of the one in fetch-upcoming.js.

const fs = require('fs');
const path = require('path');
const { getListContext } = require('./lib/list-context');
const { COUNTRIES, regionOf } = require('./build-states');

const BUILD_ROOT = path.resolve(__dirname, '..', process.env.LISTS_ROOT || 'build');
const SCAN_DAYS_AHEAD = 182; // ~6 months, same window as fetch-upcoming.js
const PAUSE_MS = 250;
const API = 'https://www.worldcubeassociation.org/api/v0';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class HttpError extends Error {
  constructor(status, url) {
    super(`${url} returned ${status}`);
    this.status = status;
  }
}

const retryable = (err) => !(err instanceof HttpError) || err.status === 429 || err.status >= 500;

// Retries 429, 5xx and network errors (waits honour Retry-After, otherwise
// 5s doubling to 60s). Other statuses are thrown straight away.
async function fetchJson(url, attempts = 8) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    let wait = Math.min(5000 * 2 ** (i - 1), 60000);
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      last = new HttpError(res.status, url);
      const retryAfter = Number(res.headers.get('retry-after'));
      if (retryAfter > 0) wait = retryAfter * 1000;
    } catch (err) {
      last = err;
    }
    if (!retryable(last)) throw last;
    if (i < attempts) await sleep(wait);
  }
  throw last;
}

const dateStr = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

// Every competition in one country starting in the window (paginated). The
// country_iso2 filter is also applied again below, in case the API ignores it.
async function listCompetitions(country) {
  const start = dateStr(0);
  const end = dateStr(SCAN_DAYS_AHEAD);
  const byId = new Map();
  for (let page = 1; page <= 200; page++) {
    const batch = await fetchJson(
      `${API}/competitions?country_iso2=${encodeURIComponent(country)}&start=${start}&end=${end}&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    const before = byId.size;
    for (const c of batch) if (c.id && (!c.country_iso2 || c.country_iso2 === country)) byId.set(c.id, c);
    console.log(`  ${country} page ${page}: ${batch.length} competitions (${byId.size - before} new)`);
    if (byId.size === before) break; // a page we've already seen
    await sleep(PAUSE_MS);
  }
  return [...byId.values()];
}

async function main() {
  const slugs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const input = JSON.parse(fs.readFileSync(path.join(BUILD_ROOT, 'states-input.json'), 'utf8'));
  const lists = input.lists.filter((l) => !slugs.length || slugs.includes(l.slug));
  if (!lists.length) {
    console.log('No state lists to scan.');
    return;
  }

  const byRegion = new Map(); // `${country}/${region}` -> competitions
  const scanned = {};
  for (const country of new Set(lists.map((l) => l.country))) {
    if (!COUNTRIES[country]) {
      console.warn(`No region setup for country ${country}; skipping its state lists.`);
      continue;
    }
    console.log(`Scanning upcoming competitions in ${country} (next ${SCAN_DAYS_AHEAD} days)...`);
    const comps = await listCompetitions(country);
    scanned[country] = comps.length;
    console.log(`Found ${comps.length} competitions in ${country}.`);
    const unmapped = [];
    for (const c of comps) {
      const region = regionOf(c.city, COUNTRIES[country]);
      if (!region) {
        unmapped.push(`${c.name || c.id} [${c.city}]`);
        continue;
      }
      const key = `${country}/${region}`;
      if (!byRegion.has(key)) byRegion.set(key, []);
      byRegion.get(key).push({
        id: c.id,
        name: c.name,
        date: c.start_date || null,
        endDate: c.end_date || null,
        city: c.city || null,
        country: c.country_iso2 || country,
        eventIds: c.event_ids || [],
        registrationOpen: c.registration_open || null,
        url: `https://www.worldcubeassociation.org/competitions/${c.id}`,
      });
    }
    if (unmapped.length) {
      console.log(`  ${unmapped.length} could not be placed in a state (left out):`);
      for (const u of unmapped.slice(0, 20)) console.log(`    ${u}`);
    }
  }

  const generatedAt = new Date().toISOString();
  for (const l of lists) {
    if (!COUNTRIES[l.country]) continue;
    const comps = (byRegion.get(`${l.country}/${l.region}`) || [])
      .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
    const ctx = getListContext(l.slug);
    fs.mkdirSync(ctx.dataDir, { recursive: true });
    fs.writeFileSync(path.join(ctx.dataDir, 'upcoming.json'), JSON.stringify({
      generatedAt,
      kind: 'state',
      country: l.country,
      region: l.region,
      scanned: scanned[l.country] || 0,
      competitions: comps,
    }));
    console.log(`${l.slug}: ${comps.length} competition(s)`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
