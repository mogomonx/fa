// Name search for the list editor: type a name (or the start of a WCA ID), pick a person,
// and their WCA ID is added to the "Members" box.
//
// Loaded on demand from lists-page.js (dynamic import inside a catch), so a problem here can
// never break the editor. The search runs in the browser: the first time the box is focused it
// loads DuckDB-WASM through db.js and copies (wca_id, name, country_iso2) from persons.parquet
// into a temporary in-memory table, so every later search is local and instant (no download
// per keystroke). All text from the data is shown with textContent, never as HTML.

const MAX_RESULTS = 8;
const MIN_CHARS = 2;
const DEBOUNCE_MS = 200;
const ID_PREFIX_RE = /^[0-9]{4}[A-Za-z]{0,4}[0-9]{0,2}$/;

let readyPromise = null; // shared by every search box on the page

// Loads DuckDB and the people table once.
function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const db = await import('./db.js');
      await db.initDB();
      await db.queryParquet(
        'CREATE OR REPLACE TEMP TABLE people_search AS SELECT wca_id, name, country_iso2 FROM persons.parquet'
      );
      return db;
    })().catch((err) => {
      readyPromise = null; // allow a retry on the next focus
      throw err;
    });
  }
  return readyPromise;
}

const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Letters (any language), digits, spaces, hyphen, apostrophe and full stop only; everything
// else (including the LIKE wildcards % _ and \) is dropped before the text goes near SQL.
function cleanTerm(raw) {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s'.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

function searchSql(term) {
  const words = term.split(' ').filter(Boolean);
  const nameMatch = words.map((w) => `name ILIKE ${sq(`%${w}%`)}`).join(' AND ');
  const idMatch = ID_PREFIX_RE.test(term) ? ` OR wca_id LIKE ${sq(`${term.toUpperCase()}%`)}` : '';
  return `SELECT wca_id, name, country_iso2 FROM people_search
    WHERE (${nameMatch})${idMatch}
    ORDER BY (lower(name) LIKE ${sq(`${term.toLowerCase()}%`)}) DESC, name
    LIMIT ${MAX_RESULTS}`;
}

function flag(iso2) {
  const c = String(iso2 ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

// True when the textarea already has this WCA ID on a line (case-insensitive).
function alreadyListed(textarea, id) {
  return new RegExp(`(^|[\\s,;])${id}(?=$|[\\s,;])`, 'i').test(textarea.value);
}

function addToTextarea(textarea, id) {
  const cur = textarea.value.replace(/\s+$/, '');
  textarea.value = cur ? `${cur}\n${id}` : id;
  textarea.dispatchEvent(new Event('input', { bubbles: true })); // updates the member count
}

/**
 * Returns the search box (a DOM node) for the given Members textarea.
 */
export function mountMemberSearch(textarea) {
  const wrap = document.createElement('div');
  wrap.className = 'field member-search';

  const label = document.createElement('span');
  label.textContent = 'Search by name';

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 40;
  input.placeholder = 'Start typing a name or WCA ID…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Search for a person by name');

  const status = document.createElement('p');
  status.className = 'board-note';
  status.textContent = 'Pick a result to add that person to the list below.';

  const results = document.createElement('div');
  results.className = 'search-results';

  wrap.append(label, input, status, results);

  let ready = false;
  let timer = null;
  let seq = 0; // drops answers that arrive after a newer search

  const clearResults = () => results.replaceChildren();

  function show(rows) {
    clearResults();
    for (const r of rows) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-result-item';
      const f = flag(r.country_iso2);
      btn.textContent = `${f ? `${f} ` : ''}${r.name} · ${r.wca_id}`;
      btn.addEventListener('click', () => {
        if (alreadyListed(textarea, r.wca_id)) {
          status.textContent = `${r.name} is already in the list.`;
        } else {
          addToTextarea(textarea, r.wca_id);
          status.textContent = `Added ${r.name}.`;
        }
        clearResults();
        input.select();
      });
      results.append(btn);
    }
  }

  async function run() {
    const term = cleanTerm(input.value);
    const mine = ++seq;
    if (term.length < MIN_CHARS) {
      clearResults();
      return;
    }
    if (!ready) {
      status.textContent = 'Getting name search ready (first use takes a few seconds)…';
      try {
        await ensureReady();
        ready = true;
      } catch (err) {
        console.warn('Name search unavailable:', err);
        status.textContent = 'Name search is unavailable right now. You can still paste WCA IDs below.';
        return;
      }
      if (mine !== seq) return; // typed more while loading: the newer call handles it
    }
    try {
      const db = await ensureReady();
      const rows = await db.queryParquet(searchSql(term));
      if (mine !== seq) return;
      show(rows);
      status.textContent = rows.length
        ? 'Pick a result to add that person to the list below.'
        : 'No one found. Try less of the name, or paste their WCA ID below.';
    } catch (err) {
      console.warn('Name search failed:', err);
      if (mine === seq) status.textContent = 'Search failed. You can still paste WCA IDs below.';
    }
  }

  input.addEventListener('focus', () => {
    // Start loading as soon as the box is used, so it is usually ready by the third letter.
    ensureReady().then(() => { ready = true; }).catch(() => {});
  });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = results.querySelector('button');
      if (first) first.click();
    }
  });

  return wrap;
}
