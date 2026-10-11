// Pulls lists + members from Supabase into build/ so the normal build scripts
// can run on them (with LISTS_ROOT=build). Also prints the slugs to build.
//
//   node scripts/sync-lists.js --pending   lists that are new or edited since last build
//   node scripts/sync-lists.js --built     lists with full data and no pending edits
//   node scripts/sync-lists.js --all       every list
//
// Lists with no members are skipped (e.g. caught mid-creation).
//
// A member's displayName is the first of: the list's own override for them,
// the name they chose for themselves (profiles.preferred_name), or null (the
// build scripts then fall back to the official WCA name).

const fs = require('fs');
const path = require('path');
const { rest } = require('./lib/supabase-admin');

const OUT = path.join(__dirname, '..', 'build');

const isPending = (l) => !l.built_at || Date.parse(l.built_at) < Date.parse(l.dirty_at);

// wca_id -> the person's own preferred name. Never fails the build: if the
// column doesn't exist yet (SQL not run) or the call errors, no one has one.
async function loadPreferredNames() {
  const map = new Map();
  try {
    const rows = await rest('GET',
      '/rest/v1/profiles?select=wca_id,preferred_name&preferred_name=not.is.null&wca_id=not.is.null&limit=1000');
    for (const r of rows || []) {
      if (r.wca_id && r.preferred_name) map.set(r.wca_id, r.preferred_name);
    }
  } catch (err) {
    console.warn(`Could not load preferred names (continuing without them): ${err.message}`);
  }
  return map;
}

async function main() {
  const mode = process.argv.includes('--pending') ? 'pending'
    : process.argv.includes('--built') ? 'built' : 'all';

  const rows = await rest('GET',
    '/rest/v1/lists?select=id,slug,name,dirty_at,built_at,data_level,list_members(wca_id,display_name)&limit=1000');
  const preferred = await loadPreferredNames();

  const chosen = rows
    .filter((l) => l.list_members.length > 0)
    .filter((l) => mode === 'all'
      || (mode === 'pending' && isPending(l))
      || (mode === 'built' && l.built_at && !isPending(l)));

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'lists'), { recursive: true });

  const state = {};
  for (const l of chosen) {
    fs.writeFileSync(path.join(OUT, 'lists', `${l.slug}.json`), JSON.stringify({
      people: l.list_members.map((m) => ({
        wcaId: m.wca_id,
        displayName: m.display_name || preferred.get(m.wca_id) || null,
      })),
    }));
    state[l.slug] = { uuid: l.id, dirty_at: l.dirty_at, data_level: l.data_level };
  }
  fs.writeFileSync(path.join(OUT, 'lists-manifest.json'), JSON.stringify({
    lists: chosen.map((l) => ({ id: l.slug, uuid: l.id, name: l.name })),
  }));
  fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify(state));

  const slugs = chosen.map((l) => l.slug).join(' ');
  const newSlugs = chosen.filter((l) => l.data_level === 'none').map((l) => l.slug).join(' ');
  console.log(`Mode ${mode}: ${chosen.length} list(s): ${slugs || '(none)'}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `slugs=${slugs}\nnew_slugs=${newSlugs}\n`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
