import { EVENT_ICONS } from './icons-data.js';

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escText = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);

// Icon for an event. Falls back to plain text if there's no icon, so a missing
// SVG never breaks a table. The hidden text keeps CSV export and screen readers working.
// `name` is plain text: it is escaped here (callers pass it unescaped).
export function eventIcon(eventId, name, { title = true } = {}) {
  const label = escText(name || eventId || '');
  const svg = Object.prototype.hasOwnProperty.call(EVENT_ICONS, eventId) ? EVENT_ICONS[eventId] : null;
  if (!svg) return label;
  return `<span class="event-icon"${title ? ` title="${label}"` : ''}>${svg}<span class="sr-only">${label}</span></span>`;
}
