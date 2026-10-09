// Uploads built JSON to the private list-data bucket (<list uuid>/<file>),
// minified (the 50MB free-tier file limit is easier to stay under).
//
//   node scripts/upload-lists.js --level=basic|full slug...   everything + meta.json
//   node scripts/upload-lists.js --files=rankings.json slug...   just those files

const fs = require('fs');
const path = require('path');
const { getListContext } = require('./lib/list-context');
const { uploadObject } = require('./lib/supabase-admin');

const FILES = [
  'rankings.json', 'individual-rankings.json', 'historical-records.json',
  'full-results.json', 'streaks.json', 'recent-activity.json', 'rolling-averages.json',
];
const LIMIT = 45 * 1024 * 1024;

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || '';
  const level = opt('level');
  const files = opt('files') ? opt('files').split(',').filter((f) => FILES.includes(f)) : FILES;
  const slugs = args.filter((a) => !a.startsWith('--'));

  for (const slug of slugs) {
    const ctx = getListContext(slug);
    for (const file of files) {
      const p = path.join(ctx.dataDir, file);
      if (!fs.existsSync(p)) { console.log(`  ${slug}/${file}: not built, skipping`); continue; }
      const body = JSON.stringify(JSON.parse(fs.readFileSync(p, 'utf8')));
      if (Buffer.byteLength(body) > LIMIT) throw new Error(`${slug}/${file} is over 45MB; cap the list size.`);
      await uploadObject(`${ctx.uuid}/${file}`, body);
      console.log(`  uploaded ${slug}/${file} (${(Buffer.byteLength(body) / 1e6).toFixed(1)} MB)`);
    }
    if (level) {
      await uploadObject(`${ctx.uuid}/meta.json`,
        JSON.stringify({ level, generatedAt: new Date().toISOString(), name: ctx.listName }));
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
