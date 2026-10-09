// Every script that needs config/data paths calls getListContext() instead
// of hardcoding them.
//
// Two modes:
//  - Built-in lists (default): config/lists-manifest.json + config/lists/<id>.json,
//    output to docs/data/lists/<id>/.
//  - Database lists: when LISTS_ROOT is set (e.g. "build"), the manifest and
//    member files come from scripts/sync-lists.js, and output goes to
//    <LISTS_ROOT>/data/<id>/ (never inside docs/, so nothing private is committed).
//
// Usage: node scripts/whatever.js [listId]
// If no listId is given, LIST_ID env var is checked, then the manifest's first entry.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BUILD_ROOT = process.env.LISTS_ROOT ? path.resolve(ROOT, process.env.LISTS_ROOT) : null;
const MANIFEST_PATH = BUILD_ROOT
  ? path.join(BUILD_ROOT, 'lists-manifest.json')
  : path.join(ROOT, 'config', 'lists-manifest.json');

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing ${MANIFEST_PATH} -- every list needs an entry here.`);
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function getListContext(explicitListId) {
  const manifest = readManifest();
  const listId = explicitListId || process.argv[2] || process.env.LIST_ID || manifest.lists[0]?.id;
  if (!listId) {
    throw new Error(`No list ID given and ${MANIFEST_PATH} has no lists.`);
  }
  const entry = manifest.lists.find((l) => l.id === listId);
  if (!entry) {
    throw new Error(`List "${listId}" isn't in ${MANIFEST_PATH}.`);
  }

  if (BUILD_ROOT) {
    return {
      listId,
      uuid: entry.uuid,
      listName: entry.name,
      membersPath: path.join(BUILD_ROOT, 'lists', `${listId}.json`),
      upcomingConfigPath: path.join(BUILD_ROOT, 'lists', `${listId}-upcoming.json`),
      dataDir: path.join(BUILD_ROOT, 'data', listId),
    };
  }
  return {
    listId,
    listName: entry.name,
    membersPath: path.join(ROOT, 'config', 'lists', `${listId}.json`),
    upcomingConfigPath: path.join(ROOT, 'config', 'lists', `${listId}-upcoming.json`),
    dataDir: path.join(ROOT, 'docs', 'data', 'lists', listId),
  };
}

module.exports = { getListContext, readManifest, MANIFEST_PATH };
