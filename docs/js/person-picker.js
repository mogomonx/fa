// Searchable person picker (type to filter, click or Enter to choose, × to clear).
//
// mountPersonPicker(select, options) hides a <select> and puts a text box in front
// of it. The <select> stays the single source of truth: it only ever holds the
// chosen person (plus a blank "(nobody)" row when allowBlank is on), so the rest of
// the code keeps reading select.value and listening for its "change" event exactly
// as before, and a state list with thousands of people no longer needs thousands of
// <option>s per box.
//
// options:
//   getPeople    () => [{ wcaId, name }, ...]   read each time the data may have changed
//   allowBlank   true = can be cleared with the × button (value '')
//   defaultToMe  true = once, start on the logged-in user if they are in the list
//                       and the visitor has not picked anyone themselves yet
//   placeholder  text shown while nothing is chosen
//
// Calling it again on the same <select> (time travel does this) only refreshes it.
// Returns { refresh(), set(wcaId, notify), touched }.

const MAX_SHOWN = 50;

const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

// The logged-in visitor's WCA ID (or null). Asked once per page load and shared by
// every picker, so five pickers do not make five database calls.
let mePromise = null;

export function getMyWcaId() {
  if (!mePromise) {
    mePromise = (async () => {
      try {
        const { supabase } = await import('./auth.js');
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return null;
        const { data } = await supabase.from('profiles').select('wca_id').eq('id', session.user.id).maybeSingle();
        return data?.wca_id || null;
      } catch (err) {
        console.warn('Could not look up the logged-in user:', err);
        return null;
      }
    })();
  }
  return mePromise;
}

export function mountPersonPicker(select, options = {}) {
  if (select._personPicker) {
    select._personPicker.refresh();
    return select._personPicker;
  }

  const opts = {
    getPeople: () => [],
    allowBlank: false,
    defaultToMe: false,
    placeholder: 'Search for a person\u2026',
    blankLabel: '(nobody)',
    ...options,
  };

  let people = [];
  let byId = new Map();
  let keys = null; // folded "name wcaid" text per person, built on first search
  let shown = [];
  let active = -1;
  let touched = false;

  const wrap = document.createElement('div');
  wrap.className = 'person-picker';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'person-picker-input';
  input.placeholder = opts.placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-label', opts.placeholder);

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'person-picker-clear';
  clear.setAttribute('aria-label', 'Clear');
  clear.title = 'Clear';
  clear.textContent = '\u00d7';
  clear.hidden = true;

  const list = document.createElement('ul');
  list.className = 'person-picker-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;

  wrap.append(input, clear, list);
  select.hidden = true;
  select.after(wrap);

  function loadPeople() {
    people = opts.getPeople() || [];
    byId = new Map(people.map((p) => [p.wcaId, p]));
    keys = null;
  }

  // Makes the hidden <select> hold exactly the chosen person (and the blank row).
  function writeSelect(id) {
    const p = id ? byId.get(id) : null;
    const items = [];
    if (opts.allowBlank) items.push(new Option(opts.blankLabel, ''));
    if (p) items.push(new Option(p.name, id));
    select.replaceChildren(...items);
    select.value = p ? id : '';
  }

  function showCurrent() {
    const p = byId.get(select.value);
    input.value = p ? p.name : '';
    clear.hidden = !(opts.allowBlank && p);
  }

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  }

  function search(query) {
    const terms = fold(query).split(/\s+/).filter(Boolean);
    if (!keys) keys = people.map((p) => `${fold(p.name)} ${String(p.wcaId).toLowerCase()}`);
    const first = []; // names that start with what was typed
    const rest = [];
    let total = 0;
    for (let i = 0; i < people.length; i += 1) {
      const k = keys[i];
      if (!terms.every((t) => k.includes(t))) continue;
      total += 1;
      const bucket = terms.length && k.startsWith(terms[0]) ? first : rest;
      if (bucket.length < MAX_SHOWN) bucket.push(people[i]);
    }
    return { found: first.concat(rest).slice(0, MAX_SHOWN), total };
  }

  function markActive(scroll) {
    list.querySelectorAll('.person-picker-item').forEach((li, i) => {
      li.classList.toggle('active', i === active);
      li.setAttribute('aria-selected', String(i === active));
      if (scroll && i === active) li.scrollIntoView({ block: 'nearest' });
    });
  }

  function render(query) {
    const { found, total } = search(query);
    shown = found;
    list.replaceChildren();
    found.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'person-picker-item';
      li.setAttribute('role', 'option');
      li.dataset.index = String(i);
      const name = document.createElement('span');
      name.textContent = p.name;
      const id = document.createElement('span');
      id.className = 'person-picker-id';
      id.textContent = p.wcaId;
      li.append(name, id);
      list.appendChild(li);
    });
    if (!found.length || total > found.length) {
      const note = document.createElement('li');
      note.className = 'person-picker-note';
      note.textContent = found.length
        ? `Showing ${found.length} of ${total}. Keep typing to narrow it down.`
        : 'Nobody matches that.';
      list.appendChild(note);
    }
    active = query.trim() && found.length ? 0 : -1;
    markActive(false);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  // user: the visitor picked this (stops "default to me" from overriding it).
  // notify: fire "change" so the page redraws (only when the value really changed).
  function choose(id, { user = false, notify = user } = {}) {
    const before = select.value;
    writeSelect(id);
    showCurrent();
    close();
    if (user) touched = true;
    if (notify && select.value !== before) select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  input.addEventListener('focus', () => {
    input.select();
    render('');
  });

  input.addEventListener('input', () => render(input.value));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) render('');
      if (!shown.length) return;
      const down = e.key === 'ArrowDown';
      active = active < 0 ? (down ? 0 : shown.length - 1) : (active + (down ? 1 : -1) + shown.length) % shown.length;
      markActive(true);
    } else if (e.key === 'Enter') {
      if (!list.hidden && shown[active]) {
        e.preventDefault();
        choose(shown[active].wcaId, { user: true });
        input.blur();
      }
    } else if (e.key === 'Escape') {
      close();
      showCurrent();
      input.blur();
    }
  });

  // Clicking away without choosing puts the current person's name back.
  input.addEventListener('blur', () => {
    close();
    showCurrent();
  });

  // mousedown (not click) so the box keeps focus until the choice is made.
  list.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const li = e.target.closest('.person-picker-item');
    if (!li || !shown[Number(li.dataset.index)]) return;
    choose(shown[Number(li.dataset.index)].wcaId, { user: true });
    input.blur();
  });

  clear.addEventListener('click', () => choose('', { user: true }));

  const controller = {
    // Reads the people again (data changed). Keeps the current choice if that
    // person is still there; otherwise falls back to nobody, or the first person.
    refresh() {
      loadPeople();
      let next = select.value;
      if (!next || !byId.has(next)) next = opts.allowBlank ? '' : people[0]?.wcaId || '';
      writeSelect(next);
      showCurrent();
    },
    set(wcaId, notify = false) {
      choose(wcaId, { notify });
    },
    get touched() {
      return touched;
    },
  };

  select._personPicker = controller;
  controller.refresh();

  if (opts.defaultToMe) {
    getMyWcaId().then((me) => {
      if (!me || touched || select.value === me || !byId.has(me)) return;
      choose(me, { notify: true });
    });
  }

  return controller;
}
