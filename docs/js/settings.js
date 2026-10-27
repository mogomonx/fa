// Colour settings on the settings page: presets, plus the custom grid
// (a colour picker and a hex box for each colour).
//
// Colours are saved in localStorage as { '--css-var': 'value' } under
// SETTINGS_STORAGE_KEY, and js/theme.js applies them on every page. A preset
// is just a full set of those values (including --accent-dim and --font), so
// theme.js knows nothing about presets. PRESET_KEY remembers which row is
// selected; it becomes 'custom' once a colour is changed by hand.
//
// Fonts: the site's CSP only allows system fonts (font-src 'self' data:), so
// presets use font stacks that already exist on people's devices.

const SETTINGS_STORAGE_KEY = 'fa-site-colours';
const PRESET_KEY = 'fa-site-preset';

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const HUMANIST = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace';
const ROUNDED = 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Segoe UI", sans-serif';
const WIDE = 'Verdana, Geneva, "Segoe UI", sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

// Every preset must define the same keys. "Default" must match :root and the
// body font in style.css; picking it clears the saved colours instead of saving them.
const PRESETS = [
  {
    id: 'default',
    name: 'Default',
    vars: {
      '--bg': '#17181c',
      '--panel': '#1f2126',
      '--panel-border': '#2c2f36',
      '--text': '#e9eaec',
      '--text-dim': '#9a9ea7',
      '--accent': '#f2a83c',
      '--accent-dim': '#8a6a35',
      '--link': '#7fb3f5',
      '--gold': '#e0b84a',
      '--silver': '#b9c0c9',
      '--bronze': '#c98a52',
      '--event-icon-colour': '#e9eaec',
      '--font': SANS,
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    vars: {
      '--bg': '#0b1220',
      '--panel': '#121c30',
      '--panel-border': '#22304d',
      '--text': '#e6edf7',
      '--text-dim': '#8fa1bd',
      '--accent': '#5ab0ff',
      '--accent-dim': '#1f4f80',
      '--link': '#8ad0ff',
      '--gold': '#f0c75e',
      '--silver': '#c3cfe0',
      '--bronze': '#d99a6c',
      '--event-icon-colour': '#cfe3ff',
      '--font': HUMANIST,
    },
  },
  {
    id: 'terminal',
    name: 'Terminal',
    vars: {
      '--bg': '#050805',
      '--panel': '#0b120b',
      '--panel-border': '#1c3a1c',
      '--text': '#b6f5b6',
      '--text-dim': '#5fa65f',
      '--accent': '#3dff6a',
      '--accent-dim': '#1a6b30',
      '--link': '#6dffb0',
      '--gold': '#e6e65c',
      '--silver': '#a8d4a8',
      '--bronze': '#d9a15b',
      '--event-icon-colour': '#3dff6a',
      '--font': MONO,
    },
  },
  {
    id: 'dusk',
    name: 'Dusk',
    vars: {
      '--bg': '#15101f',
      '--panel': '#1e172c',
      '--panel-border': '#33284a',
      '--text': '#ece6f5',
      '--text-dim': '#a496bd',
      '--accent': '#c58bff',
      '--accent-dim': '#5e3a8c',
      '--link': '#a9b8ff',
      '--gold': '#f0c060',
      '--silver': '#c9c2d9',
      '--bronze': '#d68f6e',
      '--event-icon-colour': '#e6d9ff',
      '--font': ROUNDED,
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    vars: {
      '--bg': '#0f1a14',
      '--panel': '#16241b',
      '--panel-border': '#263a2d',
      '--text': '#e4efe6',
      '--text-dim': '#8fb09a',
      '--accent': '#7bd88f',
      '--accent-dim': '#2f6b3f',
      '--link': '#8fe0c0',
      '--gold': '#e3c35a',
      '--silver': '#bcc9c0',
      '--bronze': '#c98d5a',
      '--event-icon-colour': '#cfeed8',
      '--font': WIDE,
    },
  },
  {
    id: 'sepia',
    name: 'Sepia (dark)',
    vars: {
      '--bg': '#1c1713',
      '--panel': '#261f19',
      '--panel-border': '#3d3228',
      '--text': '#efe4d4',
      '--text-dim': '#b09c85',
      '--accent': '#e0a458',
      '--accent-dim': '#7a5a2c',
      '--link': '#e3b07a',
      '--gold': '#e6bf5a',
      '--silver': '#c9bfb0',
      '--bronze': '#c8895a',
      '--event-icon-colour': '#efe4d4',
      '--font': SERIF,
    },
  },
];

const ALL_KEYS = Object.keys(PRESETS[0].vars);
const root = document.documentElement;

// True while the Custom row is open (the colour grid is showing).
let viewCustom = false;

// ---------- Storage ----------

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}') || {};
  } catch (e) {
    return {};
  }
}

function saveColours(colours) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(colours));
  } catch (e) {
    // private browsing etc.: the colours still apply for this visit
  }
}

function setPresetId(id) {
  try {
    if (id) localStorage.setItem(PRESET_KEY, id);
    else localStorage.removeItem(PRESET_KEY);
  } catch (e) {
    // ignore
  }
}

// Which preset the saved colours came from. Nothing saved = Default. Colours
// saved with no (or an unknown) preset id were picked by hand = Custom.
function currentPresetId() {
  if (Object.keys(loadSaved()).length === 0) return 'default';
  let id = null;
  try {
    id = localStorage.getItem(PRESET_KEY);
  } catch (e) {
    // ignore
  }
  return PRESETS.some((p) => p.id === id && p.id !== 'default') ? id : 'custom';
}

// ---------- Helpers ----------

// '#abc', 'ABC123' or '#aabbcc' -> '#aabbcc'; anything else -> null.
function normaliseHex(text) {
  let t = String(text).trim().toLowerCase();
  if (!t.startsWith('#')) t = `#${t}`;
  if (/^#[0-9a-f]{3}$/.test(t)) t = `#${[...t.slice(1)].map((c) => c + c).join('')}`;
  return /^#[0-9a-f]{6}$/.test(t) ? t : null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function applyVars(vars) {
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
}

function removeVars() {
  new Set([...Object.keys(loadSaved()), ...ALL_KEYS]).forEach((k) => root.style.removeProperty(k));
}

// ---------- Custom grid: keeps every picker and hex box showing the live colour ----------

function syncInputs() {
  const saved = loadSaved();
  document.querySelectorAll('#settings-grid input[type="color"]').forEach((input) => {
    const cssVar = input.dataset.var;
    const live = saved[cssVar] || getComputedStyle(root).getPropertyValue(cssVar).trim();
    const value = normaliseHex(live) || '#000000';
    input.value = value;
    const hex = input.parentElement.querySelector('.hex-input');
    if (hex) hex.value = value;
  });
}

// A colour changed by hand: apply, save, and switch to Custom.
function setColour(cssVar, value) {
  root.style.setProperty(cssVar, value);
  const saved = loadSaved();
  saved[cssVar] = value;
  saveColours(saved);
  setPresetId('custom');
  viewCustom = true;
  syncInputs();
  renderPresets();
}

// ---------- Preset list ----------

const SWATCH_KEYS = ['--panel', '--accent', '--link', '--gold', '--silver', '--bronze'];

// Each preset row is drawn in that preset's own background, text, accent and font.
function presetRow(preset, selected) {
  const v = preset.vars;
  const row = el('button', 'preset-row');
  row.type = 'button';
  row.setAttribute('aria-pressed', String(selected));
  row.style.background = v['--bg'];
  row.style.color = v['--text'];
  row.style.fontFamily = v['--font'];
  row.style.borderColor = selected ? v['--accent'] : v['--panel-border'];

  const label = el('span', 'preset-label');
  const name = el('strong', 'preset-name', preset.name);
  name.style.color = v['--accent'];
  const sample = el('span', 'preset-sample', 'Sample: 3.01 single \u00b7 3.47 average');
  sample.style.color = v['--text-dim'];
  label.append(name, sample);

  const dots = el('span', 'preset-dots');
  SWATCH_KEYS.forEach((k) => {
    const dot = el('i');
    dot.style.background = v[k];
    dot.style.borderColor = v['--panel-border'];
    dots.appendChild(dot);
  });

  row.append(label, dots);
  if (selected) {
    const tag = el('span', 'preset-tag', 'Selected');
    tag.style.color = v['--accent'];
    row.appendChild(tag);
  }
  row.addEventListener('click', () => choosePreset(preset));
  return row;
}

// The Custom row uses whatever the site looks like right now.
function customRow(selected) {
  const row = el('button', `preset-row preset-custom${selected ? ' selected' : ''}`);
  row.type = 'button';
  row.setAttribute('aria-pressed', String(selected));

  const label = el('span', 'preset-label');
  label.append(el('strong', 'preset-name', 'Custom'), el('span', 'preset-sample', 'choose your own adventure i guess.'));

  const dots = el('span', 'preset-dots');
  SWATCH_KEYS.forEach((k) => {
    const dot = el('i');
    dot.style.background = `var(${k})`;
    dots.appendChild(dot);
  });

  row.append(label, dots);
  if (selected) row.appendChild(el('span', 'preset-tag', 'Selected'));
  row.addEventListener('click', () => {
    viewCustom = true;
    setPresetId('custom');
    refresh();
  });
  return row;
}

function renderPresets() {
  const list = document.getElementById('preset-list');
  if (!list) return;
  const selectedId = viewCustom ? 'custom' : currentPresetId();
  list.replaceChildren(...PRESETS.map((p) => presetRow(p, p.id === selectedId)), customRow(selectedId === 'custom'));
}

function refresh() {
  syncInputs();
  renderPresets();
  const custom = document.getElementById('custom-colours');
  if (custom) custom.hidden = !viewCustom;
}

function choosePreset(preset) {
  viewCustom = false;
  if (preset.id === 'default') {
    removeVars();
    try {
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
    } catch (e) {
      // ignore
    }
    setPresetId(null);
  } else {
    applyVars(preset.vars);
    saveColours(preset.vars);
    setPresetId(preset.id);
  }
  refresh();
}

// ---------- Public ----------

// Applies the saved colours and brings the whole colour section up to date.
export function applyStoredSettings() {
  applyVars(loadSaved());
  viewCustom = currentPresetId() === 'custom';
  refresh();
}

// Builds the hex boxes, wires the pickers and the reset button.
export function setupSettings() {
  document.querySelectorAll('#settings-grid input[type="color"]').forEach((input) => {
    const cssVar = input.dataset.var;
    const labelText = input.closest('label')?.firstChild?.textContent.trim() || cssVar;

    const pair = el('span', 'colour-pair');
    const hex = el('input', 'hex-input');
    hex.type = 'text';
    hex.maxLength = 7;
    hex.spellcheck = false;
    hex.autocomplete = 'off';
    hex.placeholder = '#rrggbb';
    hex.setAttribute('aria-label', `${labelText} hex code`);
    input.replaceWith(pair);
    pair.append(input, hex);

    input.addEventListener('input', () => setColour(cssVar, input.value));

    // Applies as soon as a full 6-digit code is typed or pasted; "abc" style
    // shorthand is accepted when the box loses focus. Anything else goes back
    // to the live colour.
    hex.addEventListener('input', () => {
      if (/^#?[0-9a-f]{6}$/i.test(hex.value.trim())) setColour(cssVar, normaliseHex(hex.value));
    });
    hex.addEventListener('change', () => {
      const n = normaliseHex(hex.value);
      if (n) setColour(cssVar, n);
      else syncInputs();
    });
  });

  document.getElementById('settings-reset')?.addEventListener('click', () => choosePreset(PRESETS[0]));
}
