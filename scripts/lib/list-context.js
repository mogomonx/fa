// Every script that needs config/data paths calls getListContext() instead
// of hardcoding them, so the whole pipeline works the same way whether
// it's building the default list or one of several.
//
// Usage: node scripts/whatever.js [listId]
// If no listId is given, LIST_ID env var is checked, then falls back to
// the manifest's first entry.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST_PATH = path.join(ROOT, 'config', 'lists-manifest.json');

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing ${MANIFEST_PATH} -- every list (including the default one) needs an entry here.`);
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function getListContext(explicitListId) {
  const manifest = readManifest();
  const listId = explicitListId || process.argv[2] || process.env.LIST_ID || manifest.lists[0]?.id;
  if (!listId) {
    throw new Error('No list ID given and config/lists-manifest.json has no lists.');
  }
  const entry = manifest.lists.find((l) => l.id === listId);
  if (!entry) {
    throw new Error(`List "${listId}" isn't in config/lists-manifest.json.`);
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
