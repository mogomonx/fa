// Colour and font settings on the settings page: presets, the custom colour grid
// (a colour picker and a hex box for each colour), and a font picker.
//
// Colours are saved in localStorage as { '--css-var': 'value' } under
// SETTINGS_STORAGE_KEY, and js/theme.js applies them on every page. A preset
// is just a full set of those values (including --accent-dim and --font), so
// theme.js knows nothing about presets. PRESET_KEY remembers which row is
// selected; it becomes 'custom' once a colour is changed by hand.
//
// The font picker is separate: a font chosen there is saved under FONT_KEY and
// beats the font of whichever preset is selected, so it works with every preset.
// "Use the preset's font" removes it again.
//
// Fonts: system stacks need nothing. The named fonts (Inter, Nunito, Space Grotesk,
// Merriweather, JetBrains Mono) are self-hosted: the .woff2 files live in docs/fonts/
// and are declared with @font-face in style.css. If a file is missing the stack falls
// back to a system font, so nothing breaks. The site's CSP (font-src 'self') allows them.

const SETTINGS_STORAGE_KEY = 'fa-site-colours';
const PRESET_KEY = 'fa-site-preset';
const FONT_KEY = 'fa-site-font';

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const HUMANIST = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace';
const ROUNDED = 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Segoe UI", sans-serif';
const WIDE = 'Verdana, Geneva, "Segoe UI", sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

// Self-hosted fonts, each ending in a system fallback.
const INTER = `"Inter", ${SANS}`;
const NUNITO = `"Nunito", ${ROUNDED}`;
const SPACE_GROTESK = `"Space Grotesk", ${SANS}`;
const MERRIWEATHER = `"Merriweather", ${SERIF}`;
const JETBRAINS = `"JetBrains Mono", ${MONO}`;

// Every choice in the font picker. To add a font: add its @font-face to style.css
// (and the file to docs/fonts/), then add a line here.
const FONTS = [
  { id: 'system', name: 'System default', stack: SANS },
  { id: 'humanist', name: 'Trebuchet (humanist)', stack: HUMANIST },
  { id: 'wide', name: 'Verdana (wide)', stack: WIDE },
  { id: 'serif', name: 'Georgia (serif)', stack: SERIF },
  { id: 'rounded', name: 'System rounded', stack: ROUNDED },
  { id: 'mono', name: 'System monospace', stack: MONO },
  { id: 'inter', name: 'Inter', stack: INTER },
  { id: 'nunito', name: 'Nunito (rounded)', stack: NUNITO },
  { id: 'space-grotesk', name: 'Space Grotesk', stack: SPACE_GROTESK },
  { id: 'merriweather', name: 'Merriweather (serif)', stack: MERRIWEATHER },
  { id: 'jetbrains-mono', name: 'JetBrains Mono', stack: JETBRAINS },
];

// Every preset must define the same keys. "Default" must match :root and the
// body font in style.css; picking it clears the saved colours instead of saving them.
// The settings page draws these in a grid; the number of columns is --preset-cols in style.css.
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
  // ---- added 2026-10-30 ----
  {
    id: 'ember',
    name: 'Ember',
    vars: {
      '--bg': '#1a1210',
      '--panel': '#241915',
      '--panel-border': '#3b2a23',
      '--text': '#f1e6df',
      '--text-dim': '#b49a8c',
      '--accent': '#ff6b4a',
      '--accent-dim': '#8a3a2a',
      '--link': '#ffa27a',
      '--gold': '#ecc050',
      '--silver': '#cbbfb8',
      '--bronze': '#cf8758',
      '--event-icon-colour': '#f1e6df',
      '--font': SPACE_GROTESK,
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    vars: {
      '--bg': '#0a1618',
      '--panel': '#0f2124',
      '--panel-border': '#1d3a3f',
      '--text': '#e1f2f2',
      '--text-dim': '#84a9ad',
      '--accent': '#2dd4bf',
      '--accent-dim': '#146b62',
      '--link': '#7fe0ea',
      '--gold': '#e8c35a',
      '--silver': '#bdd0d3',
      '--bronze': '#cf9262',
      '--event-icon-colour': '#bff3ee',
      '--font': INTER,
    },
  },
  {
    id: 'rose',
    name: 'Rose',
    vars: {
      '--bg': '#1a0f16',
      '--panel': '#241520',
      '--panel-border': '#3d2535',
      '--text': '#f5e6ee',
      '--text-dim': '#b895a8',
      '--accent': '#ff7eb6',
      '--accent-dim': '#8a3a63',
      '--link': '#ffa8d0',
      '--gold': '#efc462',
      '--silver': '#d2c1cb',
      '--bronze': '#d48e6e',
      '--event-icon-colour': '#f8dbe9',
      '--font': NUNITO,
    },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    vars: {
      '--bg': '#121212',
      '--panel': '#1b1b1b',
      '--panel-border': '#2e2e2e',
      '--text': '#ededed',
      '--text-dim': '#8f8f8f',
      '--accent': '#e8e8e8',
      '--accent-dim': '#4a4a4a',
      '--link': '#9ec1ff',
      '--gold': '#d9b94a',
      '--silver': '#b5b5b5',
      '--bronze': '#b58355',
      '--event-icon-colour': '#ededed',
      '--font': INTER,
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    vars: {
      '--bg': '#1a1022',
      '--panel': '#251631',
      '--panel-border': '#402a50',
      '--text': '#f6e9f4',
      '--text-dim': '#b99bb8',
      '--accent': '#ff8a3d',
      '--accent-dim': '#8c4519',
      '--link': '#ffb98a',
      '--gold': '#f2c460',
      '--silver': '#d3c3d2',
      '--bronze': '#d8905f',
      '--event-icon-colour': '#f6e9f4',
      '--font': SPACE_GROTESK,
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    vars: {
      '--bg': '#0a0a14',
      '--panel': '#12121f',
      '--panel-border': '#26264a',
      '--text': '#e8e8ff',
      '--text-dim': '#8a8ab8',
      '--accent': '#00f0ff',
      '--accent-dim': '#00727a',
      '--link': '#ff4fd8',
      '--gold': '#ffe14d',
      '--silver': '#c8c8e8',
      '--bronze': '#ff9a5c',
      '--event-icon-colour': '#00f0ff',
      '--font': JETBRAINS,
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

// The font chosen in the font picker: { id, stack }, or null for "use the preset's".
function loadFont() {
  try {
    return JSON.parse(localStorage.getItem(FONT_KEY) || 'null');
  } catch (e) {
    return null;
  }
}

function saveFont(font) {
  try {
    if (font) localStorage.setItem(FONT_KEY, JSON.stringify(font));
    else localStorage.removeItem(FONT_KEY);
  } catch (e) {
    // ignore
  }
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

// Sets --font: the preset's font if the saved colours have one, then the font
// picked in the font picker on top of it. Call after anything that touches --font.
function applyFont() {
  root.style.removeProperty('--font');
  const saved = loadSaved();
  if (saved['--font']) root.style.setProperty('--font', saved['--font']);
  const picked = loadFont();
  if (picked && picked.stack) root.style.setProperty('--font', picked.stack);
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
  applyFont(); // a font picked on its own stays on top of the preset's
  refresh();
}

// ---------- Font picker ----------

// Fills <select id="setting-font"> and wires it. The first choice removes the
// font override so the selected preset's own font shows again.
function setupFontPicker() {
  const select = document.getElementById('setting-font');
  if (!select) return;

  select.replaceChildren(new Option("Use the preset's font", ''));
  FONTS.forEach((f) => {
    const opt = new Option(f.name, f.id);
    opt.style.fontFamily = f.stack; // some browsers show each choice in its own font
    select.appendChild(opt);
  });

  const picked = loadFont();
  select.value = picked && FONTS.some((f) => f.id === picked.id) ? picked.id : '';

  select.addEventListener('change', () => {
    const font = FONTS.find((f) => f.id === select.value);
    saveFont(font ? { id: font.id, stack: font.stack } : null);
    applyFont();
  });
}

// ---------- Public ----------

// Applies the saved colours and font and brings the whole colour section up to date.
export function applyStoredSettings() {
  applyVars(loadSaved());
  applyFont();
  viewCustom = currentPresetId() === 'custom';
  refresh();
}

// Builds the hex boxes, wires the pickers, the font picker and the reset button.
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
  setupFontPicker();
}
