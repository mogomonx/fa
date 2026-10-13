// State rankings page: a map of Australia, buttons for every state, and a
// "Your state" block for logged-in people with a WCA ID.
// The map works without the backend; the "Your state" block is loaded by a
// dynamic import so a backend problem can't break the page.

const COUNTRY = 'AU';

const AU_STATES = [
  { code: 'WA',  name: 'Western Australia',            points: '60,70 100,50 150,40 230,50 230,345 180,360 100,350 60,300 40,200', label: [135, 210] },
  { code: 'NT',  name: 'Northern Territory',           points: '230,50 270,30 330,60 330,240 230,240', label: [282, 150] },
  { code: 'SA',  name: 'South Australia',              points: '230,240 380,240 380,410 340,415 300,372 270,350 230,345', label: [310, 310] },
  { code: 'QLD', name: 'Queensland',                   points: '330,60 380,30 420,20 470,100 520,170 540,230 520,290 380,290 380,240 330,240', label: [450, 190] },
  { code: 'NSW', name: 'New South Wales',              points: '380,290 520,290 535,340 515,400 440,395 380,375', label: [440, 335] },
  { code: 'VIC', name: 'Victoria',                     points: '380,375 440,395 515,400 505,425 450,440 400,428 380,410', label: [448, 418] },
  { code: 'TAS', name: 'Tasmania',                     points: '440,470 500,468 490,500 450,505', label: [470, 492] },
];
const ACT = { code: 'ACT', name: 'Australian Capital Territory', cx: 488, cy: 352, r: 7 };
const ALL_STATES = [...AU_STATES, ACT, { code: 'NT', name: 'Northern Territory' }]
  .filter((s, i, a) => a.findIndex((x) => x.code === s.code) === i);
const NAMES = Object.fromEntries(ALL_STATES.map((s) => [s.code, s.name]));
const ORDER = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

const stateUrl = (code) => `index.html?list=state-${COUNTRY.toLowerCase()}-${code.toLowerCase()}`;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function buildMap(container) {
  const shapes = AU_STATES.map((s) => `
    <g class="state-shape" data-code="${s.code}" tabindex="0" role="link" aria-label="${s.name}">
      <title>${s.name}</title>
      <polygon points="${s.points}"/>
      <text x="${s.label[0]}" y="${s.label[1]}">${s.code}</text>
    </g>`).join('');
  const act = `
    <g class="state-shape" data-code="${ACT.code}" tabindex="0" role="link" aria-label="${ACT.name}">
      <title>${ACT.name}</title>
      <circle cx="${ACT.cx}" cy="${ACT.cy}" r="${ACT.r}"/>
      <text x="${ACT.cx + 26}" y="${ACT.cy + 5}">ACT</text>
    </g>`;
  container.innerHTML = `<svg viewBox="0 0 600 520" role="group" aria-label="Map of Australia">${shapes}${act}</svg>`;

  const go = (target) => {
    const g = target.closest('.state-shape');
    if (g) window.location.href = stateUrl(g.dataset.code);
  };
  container.addEventListener('click', (e) => go(e.target));
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      go(e.target);
    }
  });
}

function buildButtons(container) {
  for (const code of ORDER) {
    const a = el('a', 'csv-btn state-btn', NAMES[code]);
    a.href = stateUrl(code);
    container.appendChild(a);
  }
}

// The detected (automatic) state comes from state-assignments.json, written
// by the build into every state list's folder. null = file loaded but this
// person has no detected state; undefined = file not available yet.
let assignments;
async function getDetected(supabase, wcaId) {
  try {
    if (assignments === undefined) {
      const { data: rows } = await supabase.rpc('get_list_by_slug', { p_slug: `state-${COUNTRY.toLowerCase()}-nsw` });
      const id = rows && rows[0] && rows[0].id;
      if (!id) return undefined;
      const { data, error } = await supabase.storage.from('list-data').download(`${id}/state-assignments.json`);
      if (error || !data) return undefined;
      assignments = JSON.parse(await data.text());
    }
    return (assignments.auto && assignments.auto[wcaId]) || null;
  } catch (e) {
    return undefined;
  }
}

async function initMyState(box) {
  let auth;
  try {
    auth = await import('./auth.js');
  } catch (e) {
    return;
  }
  const { supabase } = auth;
  try { await auth.setupAuth(); } catch (e) { /* login slot only */ }

  box.hidden = false;
  box.replaceChildren(el('h3', null, 'Your state'));
  const body = el('div');
  box.appendChild(body);

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    body.appendChild(el('p', 'board-note', 'Log in with WCA to see or change which state you are ranked in.'));
    return;
  }
  const { data: profile } = await supabase.from('profiles').select('wca_id').eq('id', session.user.id).maybeSingle();
  const wcaId = profile && profile.wca_id;
  if (!wcaId) {
    body.appendChild(el('p', 'board-note', "Your WCA account has no WCA ID yet, so there's no state to set."));
    return;
  }

  let busy = false;

  async function run(call, okMessage) {
    if (busy) return;
    busy = true;
    let message = okMessage;
    try {
      const { error } = await call();
      if (error) throw error;
    } catch (err) {
      message = (err && err.message) || 'Something went wrong. Please try again.';
    }
    busy = false;
    await refresh(message);
  }

  async function refresh(message) {
    body.replaceChildren(el('p', 'board-note', 'Loading…'));
    const [reg, detected] = await Promise.all([
      supabase.rpc('get_my_region'),
      getDetected(supabase, wcaId),
    ]);
    const o = ((reg && reg.data) || [])[0] || null;

    let status;
    if (o && o.hidden) {
      status = "You're not shown in state rankings.";
    } else if (o && o.region) {
      status = `Your state: ${NAMES[o.region] || o.region}.`;
    } else if (detected) {
      status = `Your state: ${NAMES[detected] || detected} (detected from the competitions you've attended).`;
    } else if (detected === undefined) {
      status = "Your detected state isn't available yet. You can still choose one below.";
    } else {
      status = 'No state detected yet. It needs at least 2 competitions in one state, or you can choose one below.';
    }

    const wrap = el('div');
    wrap.appendChild(el('p', null, status));
    if (o && o.region && detected && detected !== o.region) {
      wrap.appendChild(el('p', 'board-note', `Detected from your competitions: ${NAMES[detected] || detected}.`));
    }

    const select = el('select');
    select.appendChild(new Option('Choose a state…', ''));
    for (const code of ORDER) select.appendChild(new Option(NAMES[code], code));
    select.value = (o && o.region) || detected || '';

    const save = el('button', 'csv-btn', 'Save my state');
    save.type = 'button';
    save.addEventListener('click', () => {
      if (!select.value) return;
      run(() => supabase.rpc('set_my_region', { p_country: COUNTRY, p_region: select.value }),
        'Saved. Rankings update after the next site rebuild.');
    });

    const row = el('div', 'state-actions');
    row.append(select, save);
    wrap.appendChild(row);

    const row2 = el('div', 'state-actions');
    if (o) {
      const auto = el('button', 'csv-btn', 'Use detected state');
      auto.type = 'button';
      auto.addEventListener('click', () => run(() => supabase.rpc('clear_my_region'),
        'Back to your detected state. Rankings update after the next site rebuild.'));
      row2.appendChild(auto);
    }
    if (!(o && o.hidden)) {
      const hide = el('button', 'csv-btn danger', 'Remove me from state rankings');
      hide.type = 'button';
      hide.addEventListener('click', () => {
        if (!confirm('Remove yourself from state rankings? You can come back any time with "Use detected state".')) return;
        run(() => supabase.rpc('hide_me_from_regions'),
          "You'll be removed from state rankings after the next site rebuild.");
      });
      row2.appendChild(hide);
    }
    wrap.appendChild(row2);

    wrap.appendChild(el('p', 'board-note',
      message || 'Changes show up after the next site rebuild, which can take a while.'));
    body.replaceChildren(wrap);
  }

  await refresh();
}

export function initStates() {
  const map = document.getElementById('state-map');
  const buttons = document.getElementById('state-buttons');
  if (map) buildMap(map);
  if (buttons) buildButtons(buttons);
  const box = document.getElementById('my-state');
  if (box) initMyState(box).catch((err) => console.warn('Your state unavailable:', err));
}
