// List lifecycle (session 15): tells the database that this list was opened by
// someone logged in. The database only counts it when that person is the list's
// owner or a member (record_list_open() in schema.sql), and also throttles it to
// once a day per list, so this is only a courtesy to avoid pointless calls.
//
// Loaded from main.js with a dynamic import and never awaited: it can fail
// silently and must never get in the way of the page.

const KEY = 'fa-list-opens';       // localStorage: { "<user id>:<list id>": timestamp }
const DAY = 24 * 60 * 60 * 1000;

export async function recordListOpen(source) {
  try {
    const list = source && source.list;
    // Only ordinary lists with an owner take part (not guest, personal or state lists).
    if (!list || list.kind !== 'group' || !list.owner_id) return;

    const { data: { session } } = await source.supabase.auth.getSession();
    if (!session) return;

    const key = `${session.user.id}:${list.id}`;
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { seen = {}; }
    if (seen[key] && Date.now() - seen[key] < DAY) return;

    seen[key] = Date.now();
    for (const [k, t] of Object.entries(seen)) {
      if (Date.now() - t > 30 * DAY) delete seen[k]; // forget old entries
    }
    try { localStorage.setItem(KEY, JSON.stringify(seen)); } catch (e) { /* storage blocked */ }

    await source.supabase.rpc('record_list_open', { p_list: list.id });
  } catch (e) {
    // never block the page
  }
}
