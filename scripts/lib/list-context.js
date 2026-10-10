// Every script that needs config/data paths calls getListContext() instead
// of hardcoding them.
//
// All lists are database lists: scripts/sync-lists.js writes the manifest and
// member files into the build folder, and output goes to <build>/data/<slug>/.
// The build folder is git-ignored, so nothing private is ever committed.
// LISTS_ROOT overrides the folder name (default "build").
//
// Usage: node scripts/whatever.js [listId]
// If no listId is given, LIST_ID env var is checked, then the manifest's first entry.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BUILD_ROOT = path.resolve(ROOT, process.env.LISTS_ROOT || 'build');
const MANIFEST_PATH = path.join(BUILD_ROOT, 'lists-manifest.json');

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing ${MANIFEST_PATH} -- run scripts/sync-lists.js first.`);
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
  return {
    listId,
    uuid: entry.uuid,
    listName: entry.name,
    membersPath: path.join(BUILD_ROOT, 'lists', `${listId}.json`),
    upcomingConfigPath: path.join(BUILD_ROOT, 'lists', `${listId}-upcoming.json`),
    dataDir: path.join(BUILD_ROOT, 'data', listId),
  };
}

module.exports = { getListContext, readManifest, MANIFEST_PATH };
