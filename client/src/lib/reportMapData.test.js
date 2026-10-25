import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AREA_FILL_OPACITY,
  MAP_GROUNDS,
  MIXED,
  NO_ANSWERS_COLOR,
  answerCounts,
  areaLegend,
  colorAtZoom,
  groundAt,
  groundSpecOf,
  parseColor,
  seenOver,
  areasGeoJSON,
  cellShare,
  cellTally,
  decodeAreas,
  decodePins,
  doorClasses,
  doorPages,
  extentBounds,
  liveFilters,
  liveShade,
  matchRows,
  pinsGeoJSON,
  presentStatuses,
  rowsTally,
  spotsOf,
  statusCounts,
} from './reportMapData.js';

// The client map counts in the browser over the compact payload (docs/PROPOSAL_CLIENT_REPORTS_
// UPGRADE.md §F11), so "N of M doors" and every chip are exact; area cells without a shown
// question's answers carry one state, never 0% (§H4, §O5).

const STATUS_KEYS = ['surveyed', 'lit_dropped', 'refused', 'not_target', 'not_home', 'wrong_address', 'no_soliciting', 'restricted'];
const S = Object.fromEntries(STATUS_KEYS.map((s, i) => [s, i]));

// Six positions: 0-2 share one spot (a building), 3 is a gap the server left empty, 4-5 apart.
const payload = {
  mode: 'pins',
  snapshotKey: 'snap-1',
  count: 5,
  statusKeys: STATUS_KEYS,
  lng: [-84.3, -84.3, -84.3, null, -84.31, -84.32],
  lat: [33.7, 33.7, 33.7, null, 33.71, 33.72],
  status: [S.surveyed, S.surveyed, S.not_home, null, S.refused, S.surveyed],
  questions: [
    { key: 'support', label: 'Support for Smith?', type: 'single_choice', options: ['Yes', 'No'] },
    { key: 'issues', label: 'Top issues?', type: 'multiple_choice', options: ['Roads', 'Schools'] },
  ],
  answers: {
    support: [0, 1, null, null, null, 0],
    issues: [[0, 1], [1], null, null, null, [0]],
  },
  extent: { minLng: -84.32, minLat: 33.7, maxLng: -84.3, maxLat: 33.72 },
};

test('decodePins keeps the reached rows, skips gaps, and groups a building into one spot', () => {
  const m = decodePins(payload, 'survey');
  assert.deepEqual(m.rows, [0, 1, 2, 4, 5]);
  assert.equal(m.spots.length, 3);
  assert.equal(m.spotOf[0], m.spotOf[2], 'same coordinate, same spot');
  assert.notEqual(m.spotOf[4], m.spotOf[5]);
  assert.equal(m.snapshotKey, 'snap-1');
  assert.deepEqual(m.questions.map((q) => q.label), ['Support for Smith?', 'Top issues?'], 'labels, never keys');
  // A lit-drop campaign never shows surveyed doors.
  assert.deepEqual(decodePins(payload, 'lit_drop').rows, [2, 4]);
});

test('filters and counts run over the arrays, so every number is exact', () => {
  const m = decodePins(payload, 'survey');
  assert.equal(matchRows(m).length, 5);
  assert.deepEqual(matchRows(m, { statuses: ['surveyed'] }), [0, 1, 5]);
  assert.deepEqual(matchRows(m, { answer: { questionKey: 'support', option: 'Yes' } }), [0, 5]);
  assert.deepEqual(matchRows(m, { answer: { questionKey: 'issues', option: 'Schools' } }), [0, 1], 'a multiple-choice answer matches any pick');
  assert.deepEqual(matchRows(m, { statuses: ['surveyed'], answer: { questionKey: 'support', option: 'No' } }), [1]);
  assert.deepEqual(matchRows(m, { answer: { questionKey: 'support', option: 'Maybe' } }), [], 'an option nobody has matches nothing');
  assert.deepEqual(statusCounts(m), { surveyed: 3, not_home: 1, refused: 1 });
  assert.deepEqual(statusCounts(m, { answer: { questionKey: 'support', option: 'Yes' } }), { surveyed: 2 });
  assert.deepEqual(answerCounts(m), { support: [2, 1], issues: [2, 2] });
  assert.deepEqual(answerCounts(m, { statuses: ['surveyed'] }), { support: [2, 1], issues: [2, 2] });
  assert.deepEqual(answerCounts(m, { statuses: ['refused'] }), { support: [0, 0], issues: [0, 0] });
  assert.deepEqual(presentStatuses(m, 'survey'), ['surveyed', 'refused', 'not_home'], 'only results a door has, in chip order');
});

test('spots: one point per spot, mixed when its doors differ, and the count follows the filters', () => {
  const m = decodePins(payload, 'survey');
  const all = spotsOf(m, matchRows(m));
  const building = all.get(m.spotOf[0]);
  assert.equal(building.status, MIXED);
  assert.deepEqual(building.rows, [0, 1, 2]);
  const fc = pinsGeoJSON(m, all);
  assert.equal(fc.features.length, 3);
  assert.deepEqual(fc.features.find((f) => f.properties.spot === m.spotOf[0]).properties, { spot: m.spotOf[0], n: 3, status: MIXED });
  const surveyedOnly = spotsOf(m, matchRows(m, { statuses: ['surveyed'] }));
  assert.deepEqual(surveyedOnly.get(m.spotOf[0]), { spot: m.spotOf[0], rows: [0, 1], status: 'surveyed' }, 'filtered to one result, it reads as that result');
});

test('a tapped spot: the tally is local; door details are asked for in pages of at most 200', () => {
  const m = decodePins(payload, 'survey');
  const t = rowsTally(m, [0, 1, 2], 'survey');
  assert.equal(t.doors, 3);
  assert.deepEqual(t.statuses.map((s) => [s.label, s.count]), [['Surveyed', 2], ["Didn't answer", 1]]);
  assert.deepEqual(t.answers.find((a) => a.key === 'support'), { key: 'support', label: 'Support for Smith?', answered: 2, options: [{ option: 'Yes', count: 1 }, { option: 'No', count: 1 }] });
  const rows = Array.from({ length: 450 }, (_, i) => 449 - i);
  const pages = doorPages(rows);
  assert.deepEqual(pages.map((p) => p.length), [200, 200, 50]);
  assert.equal(pages[0][0], 0, 'ascending');
  assert.deepEqual(extentBounds(payload.extent), [[-84.32, 33.7], [-84.3, 33.72]]);
  assert.equal(extentBounds(null), null);
});

const hex = (lng, lat) => [[lng, lat], [lng + 0.01, lat], [lng + 0.01, lat + 0.01], [lng, lat + 0.01], [lng, lat]];
const areasPayload = {
  mode: 'area',
  snapshotKey: 'snap-2',
  areaSize: 'small',
  extent: { minLng: -84.4, minLat: 33.6, maxLng: -84.2, maxLat: 33.8 },
  questions: [{ key: 'support', label: 'Support for Smith?', type: 'single_choice', options: ['Yes', 'No'] }],
  cells: [
    { h3: 'a', boundary: hex(-84.4, 33.6), doors: 38, byStatus: { surveyed: 21, not_home: 12, refused: 5 }, answers: [{ questionKey: 'support', n: 20, options: [{ option: 'Yes', count: 12 }, { option: 'No', count: 8 }] }] },
    { h3: 'b', boundary: hex(-84.3, 33.7), doors: 1, byStatus: { not_home: 1 }, answers: [] },
    { h3: 'c', boundary: hex(-84.2, 33.8).slice(0, 4), doors: 6, byStatus: { surveyed: 6 }, answers: [{ questionKey: 'support', n: 6, options: [{ option: 'No', count: 6 }] }] },
  ],
};

test('area cells: shaded by doors, or by an answer share — and "no answers to show" is its own state, never 0%', () => {
  const a = decodeAreas(areasPayload);
  assert.equal(a.cells.length, 3);
  assert.deepEqual(a.cells[2].ring[0], a.cells[2].ring[a.cells[2].ring.length - 1], 'an open outline is closed');
  const byDoors = areasGeoJSON(a);
  assert.equal(byDoors.features.length, 3);
  assert.ok(byDoors.features.every((f) => f.properties.none === false));
  assert.notEqual(byDoors.features[0].properties.color, byDoors.features[1].properties.color, 'more doors, a darker shade');

  const byYes = areasGeoJSON(a, { kind: 'answer', questionKey: 'support', option: 'Yes' });
  const [first, lone, all6] = byYes.features.map((f) => f.properties);
  assert.equal(lone.none, true);
  assert.equal(lone.color, NO_ANSWERS_COLOR);
  assert.equal(all6.none, false, 'a real 0% is a share, not "no answers"');
  assert.notEqual(all6.color, NO_ANSWERS_COLOR);
  assert.equal(first.none, false);
  assert.deepEqual(cellShare(a.cells[0], 'support', 'Yes'), { count: 12, n: 20, share: 0.6 });
  assert.equal(cellShare(a.cells[1], 'support', 'Yes'), null);
  assert.deepEqual(cellShare(a.cells[2], 'support', 'Yes'), { count: 0, n: 6, share: 0 });

  const legend = areaLegend(a, { kind: 'answer', questionKey: 'support', option: 'Yes' });
  assert.equal(legend.none, true);
  assert.equal(legend.items.length, 5);
  assert.equal(legend.title, 'Share who answered “Yes”');
  const doorsLegend = areaLegend(a);
  assert.equal(doorsLegend.none, false);
  assert.equal(doorsLegend.title, 'Doors reached in each area');
  assert.ok(doorsLegend.items.length >= 2);
});

test('a tapped area: doors reached, how they went in the report\'s own words, then each shown question', () => {
  const a = decodeAreas(areasPayload);
  const t = cellTally(a, a.cells[0], 'survey');
  assert.equal(t.doors, 38);
  assert.deepEqual(t.statuses.map((s) => `${s.label} ${s.count}`), ['Surveyed 21', 'Declined to participate 5', "Didn't answer 12"]);
  assert.deepEqual(t.answers, [{ key: 'support', label: 'Support for Smith?', n: 20, options: [{ option: 'Yes', count: 12 }, { option: 'No', count: 8 }] }]);
  assert.deepEqual(cellTally(a, a.cells[1], 'survey').answers, [{ key: 'support', label: 'Support for Smith?', hidden: true }]);
});

test('door classes come from the cells\' own spread, at most five, each starting above the last', () => {
  const classes = doorClasses([1, 2, 3, 5, 8, 13, 40, 120, 300].map((doors) => ({ doors })));
  assert.ok(classes.length >= 2 && classes.length <= 5);
  for (let i = 1; i < classes.length; i += 1) assert.ok(classes[i].low > classes[i - 1].low);
  assert.equal(classes[0].low, 1);
  assert.equal(classes[classes.length - 1].high, null);
  assert.deepEqual(doorClasses([]), []);
  assert.equal(doorClasses([{ doors: 4 }, { doors: 4 }]).length, 1);
});

test('a filter the payload no longer offers is dropped, so the map never reads "0 of N doors" with no chip to undo it (PUBUX-1)', () => {
  const questions = [{ key: 'support', options: ['Yes', 'No'] }];
  const present = ['surveyed', 'not_home'];
  const answer = { questionKey: 'support', option: 'Yes' };
  // Still offered: kept as they are.
  assert.deepEqual(liveFilters({ questions, present }, { statuses: ['not_home'], answer }), { statuses: ['not_home'], answer });
  // A map question taken off, an option gone, a result no door has any more: dropped.
  assert.equal(liveFilters({ questions: [], present }, { answer }).answer, null);
  assert.equal(liveFilters({ questions: [{ key: 'support', options: ['No'] }], present }, { answer }).answer, null);
  assert.deepEqual(liveFilters({ questions, present }, { statuses: ['refused', 'surveyed'] }).statuses, ['surveyed']);
  assert.deepEqual(liveFilters(undefined, undefined), { statuses: [], answer: null });

  // The area shade falls back to doors reached the same way.
  const shade = { kind: 'answer', questionKey: 'support', option: 'Yes' };
  assert.equal(liveShade(questions, shade), shade);
  assert.deepEqual(liveShade([], shade), { kind: 'doors' });
  assert.deepEqual(liveShade([{ key: 'support', options: ['No'] }], shade), { kind: 'doors' });
  const doors = { kind: 'doors' };
  assert.equal(liveShade([], doors), doors);
});

// ── WALK-1: the area legend shows what the hexagons look like ─────────────────────────────────────
const near = (hex, want, tol = 1) => {
  const a = parseColor(hex);
  const b = parseColor(want);
  return a.every((v, i) => Math.abs(v - b[i]) <= tol);
};

test('a legend swatch is its class colour seen over the map’s ground at the fill’s opacity (WALK-1)', () => {
  assert.equal(AREA_FILL_OPACITY, 0.62, 'the one opacity the layer paints with');
  // The reviewer's screenshot (cr2/walk shots/p20-area-map-390.png): five classes of hexagons on a
  // #eef0f3 ground, sampled. Each blend lands on the pixels within one step of rounding.
  const sampled = { '#b7d3f6': '#ccdef5', '#6da7ec': '#9ec3ef', '#2a78d6': '#74a6e1', '#1c5cab': '#6c94c6', '#0d366b': '#627d9f' };
  for (const [color, onMap] of Object.entries(sampled)) assert.ok(near(seenOver(color, '#eef0f3'), onMap), `${color} → ${seenOver(color, '#eef0f3')} ≈ ${onMap}`);
  // The old swatches were the full colour, which the hexagons never are.
  assert.ok(!near(seenOver('#2a78d6', '#eef0f3'), '#2a78d6', 20));

  const a = decodeAreas(areasPayload);
  for (const shade of [{ kind: 'doors' }, { kind: 'answer', questionKey: 'support', option: 'Yes' }]) {
    const legend = areaLegend(a, shade, { ground: '#eef0f3' });
    assert.equal(legend.ground, '#eef0f3');
    for (const it of legend.items) assert.equal(it.swatch, seenOver(it.color, '#eef0f3'), `${shade.kind}: ${it.label}`);
    // The hexagons are painted with the very colours the legend blends.
    const painted = new Set(areasGeoJSON(a, shade).features.filter((f) => !f.properties.none).map((f) => f.properties.color));
    for (const c of painted) assert.ok(legend.items.some((it) => it.color === c), `${c} is in the legend`);
  }
  // Without a ground (an old caller), the light fallback.
  assert.equal(areaLegend(a).items[0].swatch, seenOver(areaLegend(a).items[0].color, MAP_GROUNDS.light));
  // A dark basemap darkens every swatch, as it does the hexagons.
  const onDark = areaLegend(a, { kind: 'doors' }, { ground: MAP_GROUNDS.dark });
  assert.ok(parseColor(onDark.items[0].swatch)[0] < parseColor(areaLegend(a, { kind: 'doors' }, { ground: '#eef0f3' }).items[0].swatch)[0]);
});

test('the map’s ground comes from the basemap’s own background layer, at the zoom (WALK-1)', () => {
  assert.deepEqual(parseColor('#abc'), [170, 187, 204]);
  assert.deepEqual(parseColor('#eef0f3'), [238, 240, 243]);
  assert.deepEqual(parseColor('rgba(1, 2, 3, 0.5)'), [1, 2, 3]);
  assert.deepEqual(parseColor('rgb(10 20 30 / 50%)'), [10, 20, 30]);
  assert.deepEqual(parseColor('hsl(0, 0%, 100%)'), [255, 255, 255]);
  assert.deepEqual(parseColor('hsl(210, 50%, 40%)'), [51, 102, 153]);
  assert.deepEqual(parseColor('hsla(35, 32%, 91%, 1)'), parseColor('hsl(35deg 32% 91%)'));
  assert.equal(parseColor('papayawhip'), null);
  assert.equal(parseColor(['get', 'x']), null);

  const style = (layers) => ({ version: 8, layers });
  // The walk harness's blank style; a Mapbox style's land; a hidden layer and a pattern are skipped.
  assert.equal(groundSpecOf(style([{ id: 'bg', type: 'background', paint: { 'background-color': '#eef0f3' } }])), '#eef0f3');
  assert.equal(groundSpecOf(style([{ id: 'x', type: 'background', layout: { visibility: 'none' }, paint: { 'background-color': '#000' } }, { id: 'land', type: 'background', paint: { 'background-color': 'hsl(35, 32%, 91%)' } }])), 'hsl(35, 32%, 91%)');
  assert.equal(groundSpecOf(style([{ id: 'p', type: 'background', paint: { 'background-pattern': 'dots', 'background-color': '#fff' } }])), null);
  assert.equal(groundSpecOf(style([{ id: 'water', type: 'fill' }])), null);
  assert.equal(groundSpecOf(null), null);

  assert.equal(groundAt('#eef0f3', 12), '#eef0f3');
  const ramp = ['interpolate', ['linear'], ['zoom'], 10, '#000000', 14, '#ffffff'];
  assert.equal(groundAt(ramp, 8), '#000000');
  assert.equal(groundAt(ramp, 12), '#808080');
  assert.equal(groundAt(ramp, 20), '#ffffff');
  assert.equal(groundAt(['interpolate', ['exponential', 1.5], ['zoom'], 10, '#000000', 14, '#ffffff'], 12), '#808080', 'any curve read as a line');
  assert.equal(groundAt(['step', ['zoom'], '#111111', 12, '#eeeeee'], 11), '#111111');
  assert.equal(groundAt(['step', ['zoom'], '#111111', 12, '#eeeeee'], 13), '#eeeeee');
  assert.equal(groundAt({ stops: [[10, '#000000'], [14, '#ffffff']] }, 12), '#808080');
  assert.deepEqual(colorAtZoom(['match', ['get', 'x'], 'a', '#fff', '#000'], 12), null, 'anything else: unknown');
  // Unknown → the basemap's fallback; photo imagery never reads its background (the photos cover it).
  assert.equal(groundAt(['match', ['get', 'x'], 'a', '#fff', '#000'], 12, 'dark'), MAP_GROUNDS.dark);
  assert.equal(groundAt(null, 12), MAP_GROUNDS.light);
  assert.equal(groundAt('#eef0f3', 12, 'imagery'), MAP_GROUNDS.imagery);
});
