// Site home page: login slot + the "My profile" card.
// Loaded by home.html with a dynamic import so a backend problem can't break the page.

import { supabase, setupAuth } from './auth.js';

export async function initHome() {
  await setupAuth();
  const { data: { session } } = await supabase.auth.getSession();
  let wcaId = null;
  let name = null;
  if (session) {
    const { data } = await supabase.from('profiles').select('wca_id, name').eq('id', session.user.id).maybeSingle();
    wcaId = data?.wca_id ?? null;
    name = data?.name ?? null;
  }
  const m = await import('./profile-button.js');
  m.setupProfileCard(document.getElementById('my-profile-card'), { wcaId, name, loggedIn: Boolean(session) });
}
