// Weekly cleanup for the list lifecycle (session 15). Run by update-custom-lists.yml
// in `full` mode, before the lists are synced.
//
//   node scripts/cleanup-lists.js
//
// 1. Calls expire_lists(): deletes group lists nobody (owner or member) has opened
//    for 90 days, unless they are permanent. Members, opt-outs and name choices go
//    with them.
// 2. Sweeps the list-data bucket: any top-level folder (<list uuid>/) that does not
//    belong to a list in the database is deleted. This covers the lists just
//    expired, lists deleted by hand, and the leftovers of purged guest lists.
//
// Safety: the folders are listed BEFORE the list ids are read, so a list created
// during the sweep can never look like an orphan; and nothing is deleted if no
// lists could be read at all. At most 500 folders are removed per run.

const { rest, restAll, storage } = require('./lib/supabase-admin');

const BUCKET = 'list-data';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_FOLDERS_PER_RUN = 500;

async function folderNames() {
  const names = [];
  for (let offset = 0; ; offset += 100) {
    const page = await storage('POST', `/object/list/${BUCKET}`, {
      prefix: '', limit: 100, offset, sortBy: { column: 'name', order: 'asc' },
    });
    for (const entry of page || []) if (UUID_RE.test(entry.name)) names.push(entry.name);
    if (!page || page.length < 100) break;
  }
  return names;
}

async function deleteFolder(uuid) {
  const files = await storage('POST', `/object/list/${BUCKET}`, { prefix: uuid, limit: 100, offset: 0 });
  const paths = (files || []).filter((f) => f.name).map((f) => `${uuid}/${f.name}`);
  if (paths.length) await storage('DELETE', `/object/${BUCKET}`, { prefixes: paths });
  return paths.length;
}

async function main() {
  const expired = await rest('POST', '/rest/v1/rpc/expire_lists', {});
  console.log(`Expired lists deleted: ${(expired || []).length}`);

  const folders = await folderNames();
  const rows = await restAll('/rest/v1/lists?select=id&order=id');
  if (rows.length === 0) {
    throw new Error('Read no lists from the database; refusing to sweep Storage.');
  }
  const known = new Set(rows.map((r) => r.id));
  const orphans = folders.filter((f) => !known.has(f));
  console.log(`Storage folders: ${folders.length}, lists: ${known.size}, orphaned folders: ${orphans.length}`);

  let removed = 0;
  let files = 0;
  for (const uuid of orphans.slice(0, MAX_FOLDERS_PER_RUN)) {
    files += await deleteFolder(uuid);
    removed++;
  }
  if (orphans.length > MAX_FOLDERS_PER_RUN) {
    console.log(`Stopped at ${MAX_FOLDERS_PER_RUN} folders; the rest go next week.`);
  }
  console.log(`Removed ${removed} orphaned folder(s) (${files} file(s)).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
