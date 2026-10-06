const SETTINGS_STORAGE_KEY = 'fa-site-colours';

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

export function applyStoredSettings() {
  const saved = loadSaved();
  document.querySelectorAll('#settings-grid input[type="color"]').forEach((input) => {
    const cssVar = input.dataset.var;
    const computed = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    input.value = saved[cssVar] || computed || '#000000';
    if (saved[cssVar]) document.documentElement.style.setProperty(cssVar, saved[cssVar]);
  });
}

export function setupSettings() {
  document.querySelectorAll('#settings-grid input[type="color"]').forEach((input) => {
    input.addEventListener('input', () => {
      const cssVar = input.dataset.var;
      document.documentElement.style.setProperty(cssVar, input.value);
      const saved = loadSaved();
      saved[cssVar] = input.value;
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(saved));
    });
  });

  document.getElementById('settings-reset').addEventListener('click', () => {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    document.querySelectorAll('#settings-grid input[type="color"]').forEach((input) => {
      document.documentElement.style.removeProperty(input.dataset.var);
    });
    applyStoredSettings();
  });
}
