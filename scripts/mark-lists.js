// Records build progress in the database (via the mark_list_built function).
//   node scripts/mark-lists.js --level=basic|full slug...
// Reads build/state.json written by sync-lists.js.

const fs = require('fs');
const path = require('path');
const { rest } = require('./lib/supabase-admin');

async function main() {
  const args = process.argv.slice(2);
  const level = (args.find((a) => a.startsWith('--level=')) || '').split('=')[1];
  if (!['basic', 'full'].includes(level)) throw new Error('Pass --level=basic or --level=full');
  const state = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'state.json'), 'utf8'));
  for (const slug of args.filter((a) => !a.startsWith('--'))) {
    const s = state[slug];
    if (!s) continue;
    await rest('POST', '/rest/v1/rpc/mark_list_built', { p_list: s.uuid, p_dirty: s.dirty_at, p_level: level });
    console.log(`  marked ${slug} as ${level}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
