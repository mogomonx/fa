// Writes an empty full-results.json for a list so the history-based build
// scripts produce valid (empty) output. Used for the fast "basic" build of a
// new list, before the real results export has been processed.
//
// Run with: node scripts/make-empty-history.js <listId>

const fs = require('fs');
const path = require('path');
const { getListContext } = require('./lib/list-context');

const { dataDir } = getListContext();
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'full-results.json'),
  JSON.stringify({ fetchedAt: new Date().toISOString(), entries: [] }));
console.log(`Wrote empty history for ${dataDir}`);
