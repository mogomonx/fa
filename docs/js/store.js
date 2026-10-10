// Which list this page shows -- ?list=<slug> in the URL. With no list given,
// send the visitor to the picker.
export const LIST_ID = new URLSearchParams(window.location.search).get('list');
if (!LIST_ID) {
  window.location.replace('lists.html');
}
export const DATA_BASE = `data/lists/${LIST_ID}/`;

// All loaded JSON lives here. Modules read/write store.X (ES modules can't
// reassign an imported `let`, which time travel needs to do).
export const store = {
  rankings: null,
  individual: null,
  historical: null,
  upcoming: null,
  fullResults: { entries: [] },
  streaks: null,
  recentActivity: null,
  rolling: null,
  people: new Map(), // wcaId -> { name, countryIso2 }
  live: {}, // cached present-day data: { rankings, individual, historical, streaks }
  timeTravelDate: null,
};

// UI selections (selected event, single/average, view toggles).
export const state = {
  sorType: 'single',
  sorView: 'leaderboard',
  kinchView: 'leaderboard',
  eventType: 'single',
  eventId: null,
  individualType: 'single',
  individualEventId: null,
  top100Type: 'single',
  top100View: 'leaderboard',
  farType: 'single',
  farView: 'leaderboard',
  historyEventId: null,
  ageMode: 'far',
  ageEventId: '',
  streaksMode: 'current',
  streaksType: 'single',
  streaksEventId: null,
  streaksEventMode: 'current',
  prCountEventId: null,
  improvementEventId: null,
  improvementType: 'single',
  consistencyEventId: null,
  consistencyType: 'single',
  rollingEventId: null,
  rollingFormat: 'ao5',
  previousTab: 'home',
};
