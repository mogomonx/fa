// The 17 events currently recognised by the WCA.
// format: "time"  -> stored as centiseconds, lower is better
//         "fmc"   -> single = move count, average = moves x 100, lower is better
//         "mbld"  -> encoded multi-blind value, lower is better (see lib/format.js)
const EVENTS = [
  { id: '333', name: '3x3x3 Cube', format: 'time' },
  { id: '222', name: '2x2x2 Cube', format: 'time' },
  { id: '444', name: '4x4x4 Cube', format: 'time' },
  { id: '555', name: '5x5x5 Cube', format: 'time' },
  { id: '666', name: '6x6x6 Cube', format: 'time' },
  { id: '777', name: '7x7x7 Cube', format: 'time' },
  { id: '333bf', name: '3x3x3 Blindfolded', format: 'time' },
  { id: '333fm', name: '3x3x3 Fewest Moves', format: 'fmc' },
  { id: '333oh', name: '3x3x3 One-Handed', format: 'time' },
  { id: 'clock', name: 'Clock', format: 'time' },
  { id: 'minx', name: 'Megaminx', format: 'time' },
  { id: 'pyram', name: 'Pyraminx', format: 'time' },
  { id: 'skewb', name: 'Skewb', format: 'time' },
  { id: 'sq1', name: 'Square-1', format: 'time' },
  { id: '444bf', name: '4x4x4 Blindfolded', format: 'time' },
  { id: '555bf', name: '5x5x5 Blindfolded', format: 'time' },
  { id: '333mbf', name: '3x3x3 Multi-Blind', format: 'mbld' },
];

// Events that have no official "average" (only single results count).
// Note: 3x3x3 Blindfolded DOES have an official average (Bo3, introduced
// 2021) -- only the multi-attempt/cumulative ones below don't.
const SINGLE_ONLY_EVENTS = new Set(['444bf', '555bf', '333mbf']);

module.exports = { EVENTS, SINGLE_ONLY_EVENTS };
