// On-disk format for a county's walkable road geometry, and the loader the cut uses.
//
// Coordinates are stored as DELTA-ENCODED integer micro-degrees rather than floats:
// consecutive vertices of a street differ by a few dozen millionths of a degree, so the
// deltas are tiny integers that JSON writes in 2-4 characters instead of 10. Measured on
// Collier County (9,604 lines / 134,269 vertices): 2.97 MB as plain rounded floats, and
// 1.15 MB this way — small enough to commit without thinking about it. A micro-degree is
// ~11 cm, far finer than any geocode we hold, so nothing is lost.
//
// Artifact shape: { fips, year, source, lines: [[addressableFlag, [dx, dy, dx, dy, ...]]] }

const MICRO = 1e6;

export const encodeRoads = (roads, { fips, year }) => ({
  fips,
  year,
  source: 'US Census Bureau TIGER/Line (public domain)',
  lines: roads.map((r) => {
    let px = 0;
    let py = 0;
    const deltas = [];
    for (const [lng, lat] of r.coords) {
      const ix = Math.round(lng * MICRO);
      const iy = Math.round(lat * MICRO);
      deltas.push(ix - px, iy - py);
      px = ix;
      py = iy;
    }
    return [r.addressable ? 1 : 0, deltas];
  }),
});

export const decodeRoads = (artifact) =>
  artifact.lines.map(([addressable, deltas]) => {
    let x = 0;
    let y = 0;
    const coords = new Array(deltas.length / 2);
    for (let i = 0; i < deltas.length; i += 2) {
      x += deltas[i];
      y += deltas[i + 1];
      coords[i / 2] = [x / MICRO, y / MICRO];
    }
    return { coords, addressable: addressable === 1, walkable: true };
  });
