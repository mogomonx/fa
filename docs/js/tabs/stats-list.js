// Misc as a list of statistics. Every <div class="subtab-panel" data-title="..."
// data-desc="..."> directly inside #tab-misc becomes a row in the list.
// Clicking a row opens that statistic; "All statistics" returns to the list;
// "Random statistic" opens a different one at random.
// The rows keep the .subtab-btn class so setupSubtabs and showPanel(tab, subtab)
// (used by the Home page links) work unchanged.

export function setupStatsList() {
  const tab = document.getElementById('tab-misc');
  const list = document.getElementById('misc-subtabs');
  const back = document.getElementById('stat-back');
  const random = document.getElementById('stat-random');
  if (!tab || !list || !back || !random) return;

  const panels = Array.from(tab.querySelectorAll(':scope > .subtab-panel[data-title]'));

  const showList = () => {
    tab.classList.remove('stat-open');
    back.hidden = true;
    list.querySelectorAll('.subtab-btn').forEach((b) => b.classList.remove('active'));
    panels.forEach((p) => p.classList.remove('active'));
  };

  list.replaceChildren(
    ...panels.map((p) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'subtab-btn stat-row';
      btn.dataset.subtab = p.id.replace(/^subtab-/, '');
      const title = document.createElement('strong');
      title.textContent = p.dataset.title;
      const desc = document.createElement('span');
      desc.textContent = p.dataset.desc || '';
      btn.append(title, desc);
      btn.addEventListener('click', () => {
        tab.classList.add('stat-open');
        back.hidden = false;
        window.scrollTo(0, 0);
      });
      return btn;
    })
  );

  back.addEventListener('click', showList);

  random.addEventListener('click', () => {
    const rows = Array.from(list.querySelectorAll('.stat-row'));
    const current = list.querySelector('.stat-row.active');
    const pool = rows.filter((r) => r !== current);
    if (pool.length) pool[Math.floor(Math.random() * pool.length)].click();
  });

  // Choosing Misc from the menu always starts at the list.
  document.querySelectorAll('.tab-btn[data-tab="misc"]').forEach((b) => b.addEventListener('click', showList));
}
