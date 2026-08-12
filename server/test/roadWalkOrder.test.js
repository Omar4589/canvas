import { test } from 'node:test';
import assert from 'node:assert';

import { computeWalkOrder, walkLength } from '../src/services/turf/walkOrder.js';
import { loadRoadGraph } from '../src/services/turf/roads/loadRoadGraph.js';

// Walk ORDER — the sequence inside one book — measured along streets rather than straight
// lines. Separate from which doors are in the book (roadCut.js); this is what a canvasser
// actually walks, and what the printed packet prints.
//
// The fixture straddles a real Marco Island finger canal: two banks ~180 m apart in a
// straight line and ~2.8 km apart on foot. A straight-line route happily ping-pongs between
// them because they look adjacent; a road-aware one finishes one bank before crossing.
// Coordinates verified against the committed Collier artifact — see roadCut.int.test.js.
const BANK_A = { lng: -81.718334, lat: 25.930386 };
const BANK_B = { lng: -81.716574, lat: 25.930196 };

const doorsOnBothBanks = () => {
  const out = [];
  for (let i = 0; i < 6; i++) {
    out.push({ _id: `a${i}`, location: { coordinates: [BANK_A.lng, BANK_A.lat + i * 0.00012] } });
    out.push({ _id: `b${i}`, location: { coordinates: [BANK_B.lng, BANK_B.lat + i * 0.00012] } });
  }
  return out;
};

const graphFor = (doors) => loadRoadGraph(doors)?.graph || null;
const asPoints = (order, doors) => {
  const byId = new Map(doors.map((d) => [String(d._id), d]));
  return order.map((id) => {
    const c = byId.get(String(id)).location.coordinates;
    return { lng: c[0], lat: c[1] };
  });
};

test('road data covers the fixture — otherwise the rest of this file proves nothing', () => {
  const doors = doorsOnBothBanks();
  const graph = graphFor(doors);
  assert.ok(graph, 'expected the committed Collier artifact to cover these Marco coordinates');
});

test('road-aware walk order is SHORTER than straight-line, measured on foot', () => {
  const doors = doorsOnBothBanks();
  const graph = graphFor(doors);
  const straight = computeWalkOrder(doors, { optimize: true });
  const road = computeWalkOrder(doors, { optimize: true, roadGraph: graph });

  const straightOnFoot = walkLength(asPoints(straight, doors), { roadGraph: graph });
  const roadOnFoot = walkLength(asPoints(road, doors), { roadGraph: graph });

  assert.ok(roadOnFoot > 0 && straightOnFoot > 0, 'both routes must have measurable length');
  assert.ok(
    roadOnFoot < straightOnFoot,
    `road-aware order should be shorter on foot (road ${Math.round(roadOnFoot)} m vs straight ${Math.round(straightOnFoot)} m)`
  );
});

test('road-aware order stops ping-ponging between the two banks', () => {
  const doors = doorsOnBothBanks();
  const graph = graphFor(doors);
  const crossings = (order) => {
    const side = order.map((id) => String(id)[0]); // 'a' or 'b'
    let n = 0;
    for (let i = 1; i < side.length; i++) if (side[i] !== side[i - 1]) n += 1;
    return n;
  };
  const straight = crossings(computeWalkOrder(doors, { optimize: true }));
  const road = crossings(computeWalkOrder(doors, { optimize: true, roadGraph: graph }));
  // One crossing is unavoidable — the book has doors on both banks. More than one means
  // the route is going back and forth across 2.8 km of detour.
  assert.equal(road, 1, `road-aware route crossed the canal ${road} times, expected 1`);
  assert.ok(road <= straight, `straight-line crossed ${straight}, road-aware ${road}`);
});

test('with no road graph, behaviour is byte-identical to before', () => {
  const doors = doorsOnBothBanks();
  const a = computeWalkOrder(doors, { optimize: true });
  const b = computeWalkOrder(doors, { optimize: true, roadGraph: null });
  assert.deepEqual(a, b);
});

test('walkLength measures the sequence GIVEN, not a re-sorted one', () => {
  // A regression guard on a bug this file's first draft had: walkLength originally ran the
  // points through hilbertSort, which SORTS — so it silently measured a different route than
  // the caller passed in, and every comparison against it was meaningless.
  const pts = [
    { lng: -81.7183, lat: 25.9304 },
    { lng: -81.7165, lat: 25.9302 },
    { lng: -81.7183, lat: 25.9306 },
  ];
  const forward = walkLength(pts);
  const shuffled = walkLength([pts[1], pts[0], pts[2]]);
  assert.notEqual(forward, shuffled, 'different sequences must measure differently');
});
