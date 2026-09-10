// config/ isn't served by GitHub Pages (only docs/ is), so this just
// copies the manifest to somewhere the picker page (docs/lists.html) can
// fetch it from client-side.
//
// Run with: node scripts/publish-manifest.js

const fs = require('fs');
const path = require('path');
const { MANIFEST_PATH } = require('./lib/list-context');

const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'lists-manifest.json');

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${OUTPUT_PATH}`);
