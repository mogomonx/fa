import { EVENT_ICONS } from './icons-data.js';

// Icon for an event. Falls back to plain text if there's no icon, so a missing
// SVG never breaks a table. The hidden text keeps CSV export and screen readers working.
export function eventIcon(eventId, name, { title = true } = {}) {
  const label = name || eventId || '';
  const svg = EVENT_ICONS[eventId];
  if (!svg) return label;
  return `<span class="event-icon"${title ? ` title="${label}"` : ''}>${svg}<span class="sr-only">${label}</span></span>`;
}
