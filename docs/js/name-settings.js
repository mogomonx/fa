// "Your display name" settings, shown at the bottom of a personal profile.
// Backend access is imported lazily so a backend problem never breaks the page.

const VISIBILITY = [
  ['me', 'Only me', 'Shown only in your own browser. Everyone else sees your official WCA name.'],
  ['lists', 'Only on lists I choose', 'Shown on the lists you tick below. Other lists show your official name.'],
  ['everywhere', 'Everywhere', 'Shown on every list you\'re on.'],
];

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

export async function renderNameSettings(container, personalListId) {
  const box = el('div', { class: 'profile-box list-form name-settings' },
    el('p', { class: 'empty-note', text: 'Loading name settings…' }));
  container.append(box);

  let supabase;
  try {
    ({ supabase } = await import('./auth.js'));
  } catch {
    box.remove();
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { box.remove(); return; }

  let prefs;
  let groups;
  let chosen;
  try {
    const [p, inList, names] = await Promise.all([
      supabase.from('profiles').select('preferred_name, name_visibility').eq('id', session.user.id).maybeSingle(),
      supabase.rpc('lists_i_am_in'),
      supabase.rpc('my_name_lists'),
    ]);
    for (const r of [p, inList, names]) if (r.error) throw r.error;
    prefs = p.data || {};
    groups = (inList.data || []).filter((l) => l.kind !== 'personal').sort((a, b) => a.name.localeCompare(b.name));
    chosen = new Set((names.data || []).map((x) => (typeof x === 'string' ? x : Object.values(x)[0])));
  } catch (err) {
    console.warn(err);
    box.replaceChildren(el('p', { class: 'empty-note', text: 'Could not load your name settings.' }));
    return;
  }

  const nameInput = el('input', { type: 'text', maxlength: '40', placeholder: 'Leave blank to use your official WCA name' });
  nameInput.value = prefs.preferred_name ?? '';

  const startVis = prefs.name_visibility || 'me';
  const radios = VISIBILITY.map(([value, label, help]) => {
    const input = el('input', { type: 'radio', name: 'name-visibility', value });
    input.checked = value === startVis;
    return { input, node: el('label', { class: 'check-row' }, input, el('span', {}, el('strong', { text: label }), ` — ${help}`)) };
  });

  const listBoxes = el('div', { class: 'name-lists' });
  if (groups.length) {
    for (const g of groups) {
      const cb = el('input', { type: 'checkbox', value: g.id });
      cb.checked = chosen.has(g.id);
      listBoxes.append(el('label', { class: 'check-row' }, cb, el('span', { text: g.name })));
    }
  } else {
    listBoxes.append(el('p', { class: 'board-note', text: 'You\'re not on any lists yet.' }));
  }
  const syncLists = () => { listBoxes.hidden = !radios.some((r) => r.input.checked && r.input.value === 'lists'); };
  radios.forEach((r) => r.input.addEventListener('change', syncLists));
  syncLists();

  const status = el('p', { class: 'board-note' });
  const saveBtn = el('button', { class: 'csv-btn', type: 'button', text: 'Save name settings' });
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    status.className = 'board-note';
    status.textContent = 'Saving…';
    const vis = radios.find((r) => r.input.checked)?.input.value || 'me';
    const picked = [...listBoxes.querySelectorAll('input[type=checkbox]')].filter((c) => c.checked).map((c) => c.value);
    const { error } = await supabase.rpc('set_name_settings', {
      p_name: nameInput.value, p_visibility: vis, p_lists: picked,
    });
    saveBtn.disabled = false;
    if (error) {
      status.className = 'form-error';
      status.textContent = error.message || 'Something went wrong.';
      return;
    }
    status.textContent = vis === 'me'
      ? 'Saved. Only you will see this name, in your own browser.'
      : 'Saved. Lists you\'re on will show it after their next update (usually a few minutes).';
  });

  const removeBtn = el('button', {
    class: 'csv-btn danger',
    type: 'button',
    text: 'Remove my profile',
    onclick: async () => {
      if (!personalListId) return;
      if (!confirm('Remove your personal profile? You can create it again later from the lists page.')) return;
      const { error } = await supabase.from('lists').delete().eq('id', personalListId);
      if (error) { alert(error.message || 'Could not remove your profile.'); return; }
      window.location.href = 'lists.html';
    },
  });

  box.replaceChildren(
    el('h3', { text: 'Your display name' }),
    el('p', { class: 'board-note', text:
      'The name you go by. A list owner can still set a different name for you on their own list, or choose to show official names only.' }),
    el('label', { class: 'field' }, el('span', { text: 'Name' }), nameInput),
    ...radios.map((r) => r.node),
    listBoxes,
    el('div', { class: 'panel-controls' }, saveBtn, removeBtn),
    status);
}
