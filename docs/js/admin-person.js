// Admin tools for ONE person: their state override and their "everywhere" name.
// Used by admin.html (find a person) and, for admins, under a person's profile
// on a state list (mountAdminPanel, called from tabs/profile.js).
// Every action is checked by the database (is_admin()); this file is only the UI.

import { supabase } from './auth.js';

export const AU_REGIONS = [
  ['NSW', 'New South Wales'], ['VIC', 'Victoria'], ['QLD', 'Queensland'], ['WA', 'Western Australia'],
  ['SA', 'South Australia'], ['TAS', 'Tasmania'], ['ACT', 'Australian Capital Territory'], ['NT', 'Northern Territory'],
];
export const COUNTRY = 'AU';
const ID_RE = /^[0-9]{4}[A-Z]{4}[0-9]{2}$/;

export const regionName = (code) => AU_REGIONS.find(([c]) => c === code)?.[1] || code;

// Tiny DOM helper. Everything typed by people goes through textContent.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

export function stateSelect(selected) {
  const sel = el('select', {}, ...AU_REGIONS.map(([code, name]) => el('option', { value: code, text: `${code} - ${name}` })));
  if (selected) sel.value = selected;
  return sel;
}

// ---------- State data written by the build (state-assignments.json, state-unassigned.json) ----------

let stateDataPromise = null;

// Reads both files from the NSW list's folder (they are the same in every state list of the country).
// Returns { assign, unassigned } (either may be null until the first state rebuild), or null.
export function loadStateData() {
  if (!stateDataPromise) {
    stateDataPromise = (async () => {
      try {
        const { data, error } = await supabase.rpc('get_list_by_slug', { p_slug: 'state-au-nsw' });
        if (error || !data || !data.length) return null;
        const folder = data[0].id;
        const read = async (file) => {
          try {
            const { data: blob, error: e } = await supabase.storage.from('list-data').download(`${folder}/${file}`);
            if (e || !blob) return null;
            return JSON.parse(await blob.text());
          } catch {
            return null;
          }
        };
        const [assign, unassigned] = await Promise.all([read('state-assignments.json'), read('state-unassigned.json')]);
        return { assign, unassigned };
      } catch {
        return null;
      }
    })();
  }
  return stateDataPromise;
}

// Best effort only (the WCA API may refuse browser requests): the person's name.
async function lookupWcaName(id) {
  try {
    const r = await fetch(`https://www.worldcubeassociation.org/api/v0/persons/${id}`);
    if (!r.ok) return null;
    const j = await r.json();
    return j?.person?.name || null;
  } catch {
    return null;
  }
}

// ---------- The panel ----------

export async function renderPersonPanel(container, input, opts = {}) {
  const wcaId = String(input || '').trim().toUpperCase();
  if (!ID_RE.test(wcaId)) {
    container.replaceChildren(el('p', { class: 'form-error', text: 'That is not a valid WCA ID (it looks like 2012PARK03).' }));
    return;
  }
  container.replaceChildren(el('p', { class: 'empty-note', text: 'Loading…' }));

  const [reg, nm, sd, wcaName] = await Promise.all([
    supabase.rpc('admin_get_region', { p_wca_id: wcaId }),
    supabase.rpc('admin_get_name', { p_wca_id: wcaId }),
    loadStateData(),
    opts.lookupName ? lookupWcaName(wcaId) : Promise.resolve(null),
  ]);
  const failed = reg.error || nm.error;
  if (failed) {
    container.replaceChildren(el('p', { class: 'form-error', text: failed.message || 'Could not load this person.' }));
    return;
  }

  const override = reg.data?.[0] || null;
  const prof = nm.data?.[0] || null;
  const detected = sd?.assign?.auto?.[wcaId] || null;

  const status = el('p', { class: 'admin-status', text: opts.message || '' });
  status.hidden = !opts.message;

  // Runs one admin function, then redraws the panel with a confirmation message.
  const act = async (fn, args, message, confirmText) => {
    if (confirmText && !confirm(confirmText)) return;
    const { error } = await supabase.rpc(fn, args);
    if (error) {
      status.className = 'form-error';
      status.textContent = error.message || 'Something went wrong.';
      status.hidden = false;
      return;
    }
    renderPersonPanel(container, wcaId, { ...opts, message });
  };

  // ----- state -----
  const overrideText = override?.hidden ? 'removed from state rankings'
    : override?.region ? `set to ${regionName(override.region)}`
      : 'none (automatic)';
  const detectedText = detected ? regionName(detected)
    : sd?.assign ? 'none found' : 'unknown (state data not built yet)';

  const sel = stateSelect(override?.region || detected);
  const stateButtons = [
    el('button', {
      class: 'csv-btn', type: 'button', text: 'Set state',
      onclick: () => act('admin_set_region', { p_wca_id: wcaId, p_country: COUNTRY, p_region: sel.value }, `State set to ${sel.value}.`),
    }),
    override?.hidden ? null : el('button', {
      class: 'csv-btn danger', type: 'button', text: 'Remove from state rankings',
      onclick: () => act('admin_hide_region', { p_wca_id: wcaId }, 'Removed from state rankings.', `Remove ${wcaId} from state rankings?`),
    }),
    override ? el('button', {
      class: 'csv-btn', type: 'button', text: 'Back to automatic',
      onclick: () => act('admin_clear_region', { p_wca_id: wcaId }, 'Back to the automatically detected state.'),
    }) : null,
  ];
  const stateBox = el('div', { class: 'admin-block' },
    el('h4', { text: 'State rankings' }),
    el('p', { class: 'board-note', text: `Detected from competitions: ${detectedText}. Current setting: ${overrideText}.` }),
    el('div', { class: 'admin-row' }, sel, ...stateButtons));

  // ----- name -----
  let nameContent;
  if (!prof) {
    nameContent = [el('p', { class: 'board-note', text: 'This person has not logged in to the site, so they have no custom name.' })];
  } else if (prof.name_visibility !== 'everywhere') {
    nameContent = [el('p', { class: 'board-note', text: 'Their name is not set to show everywhere, so there is nothing to change.' })];
  } else {
    const nameInput = el('input', { type: 'text', maxlength: '40', placeholder: 'No name set' });
    nameInput.value = prof.preferred_name || '';
    nameContent = [
      el('p', { class: 'board-note', text: prof.preferred_name ? 'Their name is shown on every list they are on.' : 'They chose to show a name everywhere but no name is set.' }),
      el('div', { class: 'admin-row' }, nameInput,
        el('button', {
          class: 'csv-btn', type: 'button', text: 'Replace name',
          onclick: () => {
            if (!nameInput.value.trim()) {
              status.className = 'form-error';
              status.textContent = 'Type a name first, or use Clear name.';
              status.hidden = false;
              return;
            }
            act('admin_set_name', { p_wca_id: wcaId, p_name: nameInput.value }, 'Name replaced.');
          },
        }),
        prof.preferred_name ? el('button', {
          class: 'csv-btn danger', type: 'button', text: 'Clear name',
          onclick: () => act('admin_clear_name', { p_wca_id: wcaId }, 'Name cleared.', `Clear the name shown for ${wcaId}?`),
        }) : null),
    ];
  }
  const nameBox = el('div', { class: 'admin-block' }, el('h4', { text: 'Display name' }), ...nameContent);

  const title = opts.title || `${wcaName ? `${wcaName} - ` : ''}${wcaId}`;
  container.replaceChildren(
    el('h3', { text: title }),
    status,
    stateBox,
    nameBox,
    el('p', { class: 'board-note', text: 'Changes show after the next rebuild (run Update Custom Lists in mode pending to apply them now). The person is not told about changes made here.' }));
}

// ---------- Under a profile on a state list (admins only) ----------

export async function mountAdminPanel(container, wcaId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const { data, error } = await supabase.rpc('is_admin');
  if (error || data !== true) return;
  // The profile may have been replaced while we were checking.
  if (!container.textContent.includes(wcaId) || container.querySelector('#admin-state-panel')) return;
  const box = el('div', { class: 'profile-box admin-box', id: 'admin-state-panel' });
  container.append(box);
  await renderPersonPanel(box, wcaId, { title: 'Admin: state and name' });
}
