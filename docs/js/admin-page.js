// Admin view (admin.html): find a person, people with no state, state overrides, all lists.
// Loaded by admin.html with a dynamic import. Everything is enforced by the database
// (is_admin() inside the functions and policies); the page just hides itself for non-admins.

import { supabase, setupAuth } from './auth.js';
import { el, regionName, stateSelect, loadStateData, renderPersonPanel, COUNTRY } from './admin-person.js';

const $ = (id) => document.getElementById(id);
const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '-');

function table(headers, rows) {
  const thead = el('thead', {}, el('tr', {}, ...headers.map((h) => el('th', { text: h }))));
  const tbody = el('tbody', {}, ...rows.map((cells) => el('tr', {}, ...cells.map((c) => el('td', {}, c)))));
  return el('div', { class: 'scroll-table admin-table' }, el('table', {}, thead, tbody));
}

// ---------- Find a person ----------

function setupPersonTool() {
  const input = $('admin-person-input');
  const out = $('admin-person-out');
  const open = (id) => {
    input.value = id;
    renderPersonPanel(out, id, { lookupName: true });
  };
  $('admin-person-find').addEventListener('click', () => open(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(input.value); });
  const preset = new URLSearchParams(location.search).get('person');
  if (preset) open(preset);
  return (id) => {
    open(id);
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

// ---------- State overrides ----------

async function loadOverrides() {
  const { data, error } = await supabase.rpc('admin_list_regions');
  if (error) throw error;
  return data || [];
}

function renderOverrides(box, rows, openPerson) {
  if (!rows.length) {
    box.replaceChildren(el('p', { class: 'empty-note', text: 'Nobody has a state override yet.' }));
    return;
  }
  const body = rows.map((r) => [
    r.wca_id,
    r.hidden ? 'Removed from state rankings' : regionName(r.region),
    fmt(r.updated_at),
    el('button', { class: 'csv-btn', type: 'button', text: 'Open', onclick: () => openPerson(r.wca_id) }),
  ]);
  box.replaceChildren(
    el('p', { class: 'board-note', text: `${rows.length} override${rows.length === 1 ? '' : 's'}, newest first. The person can change theirs again at any time.` }),
    table(['WCA ID', 'Setting', 'Changed', ''], body));
}

// ---------- People with no state ----------

function unassignedRow(p, openPerson) {
  const sel = stateSelect(null);
  const status = el('span', { class: 'board-note' });
  const setBtn = el('button', {
    class: 'csv-btn', type: 'button', text: 'Set',
    onclick: async () => {
      setBtn.disabled = true;
      const { error } = await supabase.rpc('admin_set_region', { p_wca_id: p.wcaId, p_country: COUNTRY, p_region: sel.value });
      if (error) {
        status.className = 'form-error';
        status.textContent = error.message || 'Something went wrong.';
        setBtn.disabled = false;
        return;
      }
      sel.disabled = true;
      status.className = 'admin-status';
      status.textContent = `Set to ${sel.value}`;
    },
  });
  const seen = Object.entries(p.regions || {}).map(([r, n]) => `${r} ${n}`).join(', ');
  return [
    p.name,
    p.wcaId,
    seen || '-',
    el('div', { class: 'admin-row tight' },
      sel, setBtn,
      el('button', { class: 'csv-btn', type: 'button', text: 'Open', onclick: () => openPerson(p.wcaId) }),
      status),
  ];
}

function renderUnassigned(box, data, overrides, openPerson) {
  const file = data?.unassigned;
  if (!file) {
    box.replaceChildren(el('p', { class: 'empty-note', text: 'Not built yet. This list appears after the next state rebuild.' }));
    return;
  }
  const handled = new Set(overrides.map((o) => o.wca_id));
  const people = (file.people || []).filter((p) => !handled.has(p.wcaId));
  $('admin-unassigned-title').textContent = `People with no state (${people.length})`;
  if (!people.length) {
    box.replaceChildren(el('p', { class: 'empty-note', text: 'Everyone who competes in Australia has a state.' }));
    return;
  }
  box.replaceChildren(
    el('p', { class: 'board-note', text:
      `Australian competitors who have competed but not twice in any one state. "Seen in" shows how many competitions they have in each state. ` +
      `As of the last state build (${fmt(file.generatedAt)}); people you set show up in the rankings after the next rebuild.` }),
    table(['Name', 'WCA ID', 'Seen in', 'Set their state'], people.map((p) => unassignedRow(p, openPerson))));
}

// ---------- Lists ----------

const listStatus = (l) => {
  if (l.data_level === 'none') return 'Not built yet';
  if (!l.built_at || Date.parse(l.built_at) < Date.parse(l.dirty_at)) return 'Updating';
  return 'Up to date';
};

async function renderLists(box) {
  box.replaceChildren(el('p', { class: 'empty-note', text: 'Loading…' }));
  const { data, error } = await supabase.rpc('admin_list_overview');
  if (error) {
    box.replaceChildren(el('p', { class: 'form-error', text: error.message || 'Could not load lists.' }));
    return;
  }
  let rows = data || [];
  const filter = el('input', { type: 'text', placeholder: 'Filter by list name, link name or owner' });
  const holder = el('div');
  const note = el('p', { class: 'board-note' });

  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    const shown = rows.filter((l) => !q || [l.name, l.slug, l.owner_name, l.owner_wca_id].some((v) => String(v || '').toLowerCase().includes(q)));
    note.textContent = `${shown.length} of ${rows.length} lists. Personal profiles and guest lists are not shown.`;
    holder.replaceChildren(table(
      ['List', 'Owner', 'Who can see it', 'Members', 'Status', ''],
      shown.map((l) => [
        l.data_level === 'none' ? l.name : el('a', { href: `index.html?list=${encodeURIComponent(l.slug)}`, text: l.name }),
        `${l.owner_name || '-'}${l.owner_wca_id ? ` (${l.owner_wca_id})` : ''}`,
        l.visibility,
        String(l.member_count),
        listStatus(l),
        el('div', { class: 'admin-row tight' },
          el('a', { class: 'csv-btn', href: `lists.html?edit=${encodeURIComponent(l.slug)}`, text: 'Edit' }),
          el('button', {
            class: 'csv-btn danger', type: 'button', text: 'Delete',
            onclick: async () => {
              if (!confirm(`Delete "${l.name}" (owned by ${l.owner_name || 'unknown'})? This cannot be undone.`)) return;
              const { error: e } = await supabase.from('lists').delete().eq('id', l.id);
              if (e) { alert(e.message || 'Could not delete the list.'); return; }
              rows = rows.filter((x) => x.id !== l.id);
              draw();
            },
          })),
      ])));
  };
  filter.addEventListener('input', draw);
  box.replaceChildren(filter, note, holder);
  draw();
}

// ---------- Entry point ----------

export async function initAdmin() {
  await setupAuth();
  const gate = $('admin-gate');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    gate.textContent = 'Log in with WCA to continue.';
    return;
  }
  const { data: isAdmin, error } = await supabase.rpc('is_admin');
  if (error || isAdmin !== true) {
    gate.textContent = 'This page is for admins only.';
    return;
  }
  gate.hidden = true;
  $('admin-body').hidden = false;

  const openPerson = setupPersonTool();
  renderLists($('admin-lists'));

  try {
    const [overrides, stateData] = await Promise.all([loadOverrides(), loadStateData()]);
    renderOverrides($('admin-overrides'), overrides, openPerson);
    renderUnassigned($('admin-unassigned'), stateData, overrides, openPerson);
  } catch (err) {
    console.warn(err);
    $('admin-overrides').replaceChildren(el('p', { class: 'form-error', text: 'Could not load state overrides.' }));
    $('admin-unassigned').replaceChildren(el('p', { class: 'form-error', text: 'Could not load the people with no state.' }));
  }
}
