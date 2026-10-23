// Harness for docs/parquet-test.html (rebuild step 5, browser Parquet prototype).
// Reads PBs and ranks from the Parquet files through db.js, computes rankings with
// rankings-core.js, prints timings, and (for a list) diffs against the built rankings.json.
// Nothing on the real site imports this file.

import { activeEvents, peopleFromRows, computeRankings, diffRankings } from './rankings-core.js';

const $ = (id) => document.getElementById(id);
const out = $('pt-out');
const ID_RE = /^[0-9]{4}[A-Z]{4}[0-9]{2}$/;
const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const ms = (n) => `${Math.round(n).toLocaleString()} ms`;
let running = false;

function say(line = '') {
  out.textContent += `${line}\n`;
}

// Bytes the browser reports for Parquet requests. Cross-origin responses usually report 0
// unless the server sends Timing-Allow-Origin, so this may show as unavailable.
function parquetBytes() {
  let total = 0;
  for (const e of performance.getEntriesByType('resource')) {
    if (/\.parquet|parquet-meta/.test(e.name)) total += e.encodedBodySize || e.transferSize || 0;
  }
  return total;
}

async function run() {
  if (running) return;
  running = true;
  $('pt-run').disabled = true;
  out.textContent = '';

  const t0 = performance.now();
  const steps = [];
  const step = async (label, fn) => {
    const s = performance.now();
    const r = await fn();
    steps.push([label, performance.now() - s]);
    return r;
  };

  try {
    const mode = $('pt-mode').value;
    const bytes0 = parquetBytes();

    const db = await step('Load db.js module', () => import('./db.js'));
    await step('Start DuckDB-WASM', () => db.initDB());

    // ---- who are the people? ----
    let order = [];
    let displayNames = {};
    let listInfo = null;
    let personRows = [];

    if (mode === 'slug') {
      const slug = $('pt-slug').value.trim();
      listInfo = await step('Look up list members (Supabase)', async () => {
        const { supabase } = await import('./auth.js');
        const { data, error } = await supabase.rpc('get_list_by_slug', { p_slug: slug });
        if (error || !data || !data.length) throw new Error('List not found. If it is private, log in on the site first, then reload this page.');
        const { data: members, error: e2 } = await supabase
          .from('list_members').select('wca_id, display_name').eq('list_id', data[0].id);
        if (e2) throw new Error(`Could not read members: ${e2.message}`);
        return { supabase, list: data[0], members };
      });
      order = listInfo.members.map((m) => m.wca_id);
      for (const m of listInfo.members) if (m.display_name) displayNames[m.wca_id] = m.display_name;
    } else if (mode === 'ids') {
      order = [...new Set($('pt-ids').value.toUpperCase().split(/[\s,]+/).filter(Boolean))];
      const badIds = order.filter((id) => !ID_RE.test(id));
      if (badIds.length) throw new Error(`Not valid WCA IDs: ${badIds.slice(0, 5).join(', ')}`);
      if (!order.length) throw new Error('Paste at least one WCA ID.');
    }

    // The selected people go into a temp table; giant IN (...) lists crashed DuckDB-WASM
    // ("memory access out of bounds") with a few thousand IDs.
    const loadSelection = async (ids) => {
      await db.queryParquet('CREATE OR REPLACE TEMP TABLE pt_sel (wca_id VARCHAR)');
      for (let i = 0; i < ids.length; i += 500) {
        await db.queryParquet(`INSERT INTO pt_sel VALUES ${ids.slice(i, i + 500).map((id) => `(${sq(id)})`).join(',')}`);
      }
    };

    // ---- persons ----
    if (mode === 'country') {
      const country = $('pt-country').value.trim();
      if (!country) throw new Error('Type a country name, e.g. Australia.');
      personRows = await step('Query persons (by country)', () => db.queryParquet(
        `SELECT wca_id, name, country_id FROM persons.parquet
         WHERE wca_id IS NOT NULL AND wca_id <> '' AND lower(country_id) = lower(${sq(country)})`));
      personRows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const max = Number($('pt-max').value);
      if (max > 0) personRows = personRows.slice(0, max);
      order = personRows.map((r) => r.wca_id);
      if (!order.length) throw new Error(`No people found for country "${country}". The Parquet files hold the country NAME (e.g. Australia).`);
      await step('Load selection into a temp table', () => loadSelection(order));
    } else {
      await step('Load selection into a temp table', () => loadSelection(order));
      personRows = await step('Query persons (by id)', () => db.queryParquet(
        'SELECT wca_id, name, country_id FROM persons.parquet WHERE wca_id IN (SELECT wca_id FROM pt_sel)'));
    }

    // ---- ranks ----
    const events = activeEvents();
    const eventIds = new Set(events.map((e) => e.id));
    const evList = [...eventIds].map(sq).join(',');
    const ranksSql = (kind) => `SELECT wca_id, event_id, best, world_rank, continent_rank, country_rank
      FROM ranks_${kind}.parquet WHERE wca_id IN (SELECT wca_id FROM pt_sel) AND event_id IN (${evList})`;
    const singleRows = await step('Query ranks_single', () => db.queryParquet(ranksSql('single')));
    const averageRows = await step('Query ranks_average', () => db.queryParquet(ranksSql('average')));

    // ---- compute ----
    let people = peopleFromRows(personRows, singleRows, averageRows, eventIds, order, displayNames);
    if (mode === 'country') people = people.filter((p) => Object.keys(p.events).length > 0); // like state lists: no result = left out
    const result = await step('Compute rankings, Sum of Ranks, Kinch', async () => computeRankings(people, events));

    // ---- optional diff ----
    let diff = null;
    if (mode === 'slug' && $('pt-compare').checked) {
      diff = await step('Download built rankings.json + compare', async () => {
        const { data, error } = await listInfo.supabase.storage.from('list-data').download(`${listInfo.list.id}/rankings.json`);
        if (error || !data) throw new Error('Could not download the built rankings.json');
        return diffRankings(result, JSON.parse(await data.text()));
      });
    }

    const total = performance.now() - t0;
    const bytes = parquetBytes() - bytes0;

    // ---- report ----
    say(`Mode: ${mode}${mode === 'slug' ? ` (${$('pt-slug').value.trim()})` : ''}`);
    say(`People: ${people.length} (asked for ${order.length}); ranks rows: ${singleRows.length} single, ${averageRows.length} average`);
    say(`Parquet address used: ${db.getParquetBase()}`);
    say(`Parquet bytes reported by the browser: ${bytes ? `${(bytes / 1e6).toFixed(2)} MB` : 'n/a (cross-origin sizes hidden; check the Network tab)'}`);
    say();
    say('Timings');
    for (const [label, t] of steps) say(`  ${label.padEnd(44)} ${ms(t)}`);
    say(`  ${'TOTAL'.padEnd(44)} ${ms(total)}`);
    say();
    say('Top 5 Kinch');
    result.kinch.overall.slice(0, 5).forEach((r, i) => say(`  ${i + 1}. ${r.name}  ${r.score}`));
    const three = result.events.find((e) => e.id === '333');
    if (three) {
      say('Top 5 3x3 average');
      three.average.slice(0, 5).forEach((r) => say(`  ${r.rank}. ${r.name}  ${r.display}`));
    }

    if (diff) {
      say();
      say(`Compared with the built rankings.json: ${diff.compared.toLocaleString()} values checked.`);
      say(`  REAL mismatches (values, ranks, Sum of Ranks, Kinch): ${diff.hard}`);
      say(`  Official-rank drift (expected: live API vs the export copy): ${diff.official}, largest world-rank difference ${diff.maxWorldDrift}`);
      diff.notes.forEach((n) => say(`  note: ${n}`));
      diff.hardSamples.forEach((s) => say(`  ${s}`));
      if (diff.hard > diff.hardSamples.length) say(`  ... and ${diff.hard - diff.hardSamples.length} more`);
      diff.officialSamples.forEach((s) => say(`  (official) ${s}`));
    }
  } catch (err) {
    say(`ERROR: ${err.message || err}`);
    if (/out of bounds|unreachable|abort/i.test(String(err && err.message))) {
      say('DuckDB-WASM has crashed. Reload this page before running again.');
    }
    say('Steps finished before the error:');
    for (const [label, t] of steps) say(`  ${label.padEnd(44)} ${ms(t)}`);
    console.error(err);
  } finally {
    running = false;
    $('pt-run').disabled = false;
  }
}

function syncMode() {
  const mode = $('pt-mode').value;
  $('pt-slug-row').classList.toggle('pt-hide', mode !== 'slug');
  $('pt-ids-row').classList.toggle('pt-hide', mode !== 'ids');
  $('pt-country-row').classList.toggle('pt-hide', mode !== 'country');
}

$('pt-mode').addEventListener('change', syncMode);
$('pt-run').addEventListener('click', run);
$('pt-copy').addEventListener('click', () => navigator.clipboard.writeText(out.textContent).catch(() => {}));
syncMode();
