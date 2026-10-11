// Pulls lists + members from Supabase into build/ so the normal build scripts
// can run on them (with LISTS_ROOT=build). Also prints the slugs to build.
//
//   node scripts/sync-lists.js --pending   lists that are new or edited since last build
//   node scripts/sync-lists.js --built     lists with full data and no pending edits
//   node scripts/sync-lists.js --all       every list
//
// Lists with no members are skipped (e.g. caught mid-creation).
//
// A member's displayName, in order:
//   1. the name the list owner typed for them on this list
//   2. (skipped when the list is "official names only")
//   3. their own preferred name, if they chose "everywhere", or "lists" and
//      picked this list (personal profile lists always use it)
//   4. null -> the build scripts fall back to the official WCA name

const fs = require('fs');
const path = require('path');
const { rest } = require('./lib/supabase-admin');

const OUT = path.join(__dirname, '..', 'build');

const isPending = (l) => !l.built_at || Date.parse(l.built_at) < Date.parse(l.dirty_at);

// wca_id -> { name, visibility, lists:Set(list uuid) }. Never fails the build:
// if the tables/columns aren't there yet, nobody has a preferred name.
async function loadNamePrefs() {
  const prefs = new Map();
  try {
    const profiles = await rest('GET',
      '/rest/v1/profiles?select=wca_id,preferred_name,name_visibility&preferred_name=not.is.null&wca_id=not.is.null&limit=1000');
    for (const p of profiles || []) {
      prefs.set(p.wca_id, { name: p.preferred_name, visibility: p.name_visibility, lists: new Set() });
    }
    const chosen = await rest('GET', '/rest/v1/preferred_name_lists?select=list_id,wca_id&limit=10000');
    for (const c of chosen || []) prefs.get(c.wca_id)?.lists.add(c.list_id);
  } catch (err) {
    console.warn(`Could not load preferred names (continuing without them): ${err.message}`);
  }
  return prefs;
}

function pickDisplayName(list, member, prefs) {
  if (member.display_name) return member.display_name;   // the owner's own name wins
  if (list.official_names_only) return null;
  const p = prefs.get(member.wca_id);
  if (!p) return null;
  if (list.kind === 'personal') return p.name;           // private to them
  if (p.visibility === 'everywhere') return p.name;
  if (p.visibility === 'lists' && p.lists.has(list.id)) return p.name;
  return null;
}

async function main() {
  const mode = process.argv.includes('--pending') ? 'pending'
    : process.argv.includes('--built') ? 'built' : 'all';

  const rows = await rest('GET',
    '/rest/v1/lists?select=id,slug,name,kind,official_names_only,dirty_at,built_at,data_level,list_members(wca_id,display_name)&limit=1000');
  const prefs = await loadNamePrefs();

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
        displayName: pickDisplayName(l, m, prefs),
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
