// Booking-style date picker: a popup calendar for ISO dates (YYYY-MM-DD).
//
// Range mode: setupRangePicker(startInput, endInput). Two months side by side
// (one on narrow screens). Click a start date, then an end date. When a range
// is chosen it writes both values and fires a 'change' event on each, so
// existing change listeners keep working. Opening from the end input keeps the
// start date and only asks for a new end.
//
// Single mode: setupDatePicker(input). One month; click a day to choose it.
// Writes the value and fires a 'change' event on the input.
//
// Both attach to existing readonly text inputs holding ISO dates.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parse(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

// One input: pick a single date.
export function setupDatePicker(input) {
  setupRangePicker(input, null);
}

// Two inputs: pick a start and an end date. (With no end input it works as a
// single-date picker; setupDatePicker is the clearer way to ask for that.)
export function setupRangePicker(startInput, endInput) {
  if (!startInput) return;
  const single = !endInput;
  const inputs = [startInput, endInput].filter(Boolean);

  const pop = document.createElement('div');
  pop.className = 'range-picker';
  pop.hidden = true;
  document.body.appendChild(pop);

  let isOpen = false;
  let today = null;
  let view = null; // first day of the left-hand month
  let start = null;
  let end = null;
  let phase = 'start'; // which date the next click sets
  let hover = null; // ISO string under the cursor while choosing an end

  function monthHtml(y, m) {
    const offset = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
    const days = new Date(y, m + 1, 0).getDate();
    let cells = DOW.map((d) => `<span class="rp-dow">${d}</span>`).join('');
    cells += '<span></span>'.repeat(offset);
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, m, d);
      cells += `<button type="button" class="rp-day${iso(date) === iso(today) ? ' rp-today' : ''}" data-date="${iso(date)}"${date > today ? ' disabled' : ''}>${d}</button>`;
    }
    return `<div class="rp-month"><div class="rp-title">${MONTHS[m]} ${y}</div><div class="rp-grid">${cells}</div></div>`;
  }

  function render() {
    const right = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    const atMax = view >= new Date(today.getFullYear(), today.getMonth(), 1);
    pop.innerHTML = `
      <div class="rp-head">
        <span class="rp-status"></span>
        <span class="rp-navs">
          <button type="button" class="rp-nav" data-nav="-1" aria-label="Previous month">&lsaquo;</button>
          <button type="button" class="rp-nav" data-nav="1" aria-label="Next month"${atMax ? ' disabled' : ''}>&rsaquo;</button>
        </span>
      </div>
      <div class="rp-months">
        ${monthHtml(view.getFullYear(), view.getMonth())}
        ${single ? '' : monthHtml(right.getFullYear(), right.getMonth())}
      </div>`;
    paint();
  }

  // Updates highlight classes + status text without rebuilding the DOM.
  function paint() {
    const s = start ? iso(start) : null;
    const e = end ? iso(end) : null;
    // Single mode: the chosen day is both the start and the end of its "range".
    const previewEnd = single ? s : phase === 'end' && s && hover && hover >= s ? hover : e;
    pop.querySelectorAll('.rp-day').forEach((b) => {
      const k = b.dataset.date;
      b.classList.toggle('rp-start', k === s);
      b.classList.toggle('rp-end', !!previewEnd && k === previewEnd);
      b.classList.toggle('rp-in', !!(s && previewEnd && k > s && k < previewEnd));
    });
    const status = pop.querySelector('.rp-status');
    if (status) {
      status.textContent = single ? 'Select a date' : phase === 'start' ? 'Select a start date' : 'Now select an end date';
    }
  }

  function position(anchor) {
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const maxLeft = document.documentElement.clientWidth - w - 8;
    pop.style.top = `${window.scrollY + r.bottom + 6}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, maxLeft))}px`;
  }

  function open(opener) {
    today = new Date();
    today.setHours(0, 0, 0, 0);
    start = parse(startInput.value);
    end = single ? null : parse(endInput.value);
    phase = !single && opener === endInput && start ? 'end' : 'start';
    hover = null;
    const anchor = start || today;
    view = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const max = new Date(today.getFullYear(), today.getMonth(), 1);
    if (view > max) view = max;
    isOpen = true;
    pop.hidden = false;
    render();
    position(opener);
  }

  function close() {
    isOpen = false;
    pop.hidden = true;
  }

  function pick(key) {
    if (single) {
      start = parse(key);
      startInput.value = iso(start);
      startInput.dispatchEvent(new Event('change', { bubbles: true }));
      close();
      return;
    }
    if (phase === 'start' || (start && key < iso(start))) {
      start = parse(key);
      end = null;
      phase = 'end';
      hover = null;
      paint();
      return;
    }
    end = parse(key);
    startInput.value = iso(start);
    endInput.value = iso(end);
    startInput.dispatchEvent(new Event('change', { bubbles: true }));
    endInput.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  }

  pop.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      if (nav.disabled) return;
      view = new Date(view.getFullYear(), view.getMonth() + Number(nav.dataset.nav), 1);
      render();
      return;
    }
    const day = e.target.closest('.rp-day');
    if (day && !day.disabled) pick(day.dataset.date);
  });

  pop.addEventListener('mouseover', (e) => {
    const day = e.target.closest('.rp-day');
    if (day && phase === 'end') {
      hover = day.dataset.date;
      paint();
    }
  });

  pop.addEventListener('mouseleave', () => {
    hover = null;
    if (isOpen) paint();
  });

  inputs.forEach((input) => {
    input.addEventListener('click', () => open(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(input);
      }
    });
  });

  document.addEventListener('mousedown', (e) => {
    if (!isOpen) return;
    if (pop.contains(e.target) || inputs.includes(e.target)) return;
    close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) close();
  });

  window.addEventListener('resize', () => {
    if (isOpen) close();
  });
}
