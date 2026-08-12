// Minimal readers for the two files a TIGER/Line ROADS download actually contains:
// an ESRI shapefile of PolyLine geometry (.shp) and a dBASE table of attributes (.dbf).
//
// Hand-rolled rather than adding a dependency. Both formats are frozen, ancient and tiny to
// parse — the whole of what we need is ~100 lines — and the alternative packages pull in a
// stream/buffer stack for the same result. We only ever read; nothing here writes.
//
// TIGER specifics worth knowing before touching this:
//   - Geometry is unprojected lon/lat on NAD83 (the .prj says GCS_North_American_1983), which
//     is within a metre of WGS84 everywhere in the US — fine to treat as our lng/lat.
//   - Roads are PolyLine (shape type 3). A record can hold several PARTS (disjoint strings);
//     each part becomes its own line, or a false edge would join their endpoints.
//   - Records in the .shp and rows in the .dbf are positionally aligned — the Nth shape
//     belongs to the Nth attribute row. There is no join key.

const SHP_HEADER_BYTES = 100;
const SHAPE_POLYLINE = 3;
const SHAPE_NULL = 0;

// Road class codes (MTFCC) a canvasser can actually travel on foot. Deliberately generous —
// an edge we wrongly include only makes the graph slightly more connected, while one we
// wrongly drop can strand a whole street and push its doors into a far book. Excluded on
// purpose: S1500 (4WD trail), S1750 (internal census-use lines that are not roads at all).
export const WALKABLE_MTFCC = new Set([
  'S1100', // primary road
  'S1200', // secondary road
  'S1400', // local neighborhood road / rural road / city street — the bulk of any county
  'S1630', // ramp
  'S1640', // service drive
  'S1710', // walkway / pedestrian trail
  'S1720', // stairway
  'S1730', // alley
  'S1740', // private road (gated communities, mobile home parks)
  'S1780', // parking lot road
  'S1820', // bike path
  'S1830', // bridle path
]);

// Road classes doors are expected to sit ON. Narrower than WALKABLE_MTFCC: a house fronts a
// street, not a ramp or a stairway, so these are the lines worth snapping doors to.
export const ADDRESSABLE_MTFCC = new Set(['S1200', 'S1400', 'S1740']);

// dBASE III table -> array of plain objects, one per record. Only the fields named in `want`
// are decoded (a TIGER roads .dbf is ~1.2 MB and we need two columns of it).
export const readDbf = (buf, want = null) => {
  const recordCount = buf.readUInt32LE(4);
  const headerBytes = buf.readUInt16LE(8);
  const recordBytes = buf.readUInt16LE(10);

  const fields = [];
  let offset = 0;
  for (let p = 32; p < headerBytes && buf[p] !== 0x0d; p += 32) {
    const name = buf.toString('ascii', p, p + 11).replace(/\0.*$/, '');
    const len = buf[p + 16];
    fields.push({ name, start: offset, len, wanted: !want || want.includes(name) });
    offset += len;
  }

  const rows = new Array(recordCount);
  for (let r = 0; r < recordCount; r++) {
    // +1 skips the record's deletion flag byte
    const base = headerBytes + r * recordBytes + 1;
    const row = {};
    for (const f of fields) {
      if (!f.wanted) continue;
      row[f.name] = buf.toString('latin1', base + f.start, base + f.start + f.len).trim();
    }
    rows[r] = row;
  }
  return rows;
};

// .shp -> [{ index, parts: [[[lng, lat], ...], ...] }], in file order so the caller can line
// each shape up with readDbf's row at the same index.
export const readPolylines = (buf) => {
  const out = [];
  let cursor = SHP_HEADER_BYTES;
  let index = 0;
  while (cursor + 8 <= buf.length) {
    // Record header is BIG-endian; record content is little-endian. Yes, really.
    const contentBytes = buf.readInt32BE(cursor + 4) * 2;
    const body = cursor + 8;
    const type = buf.readInt32LE(body);

    if (type === SHAPE_POLYLINE) {
      const partCount = buf.readInt32LE(body + 36);
      const pointCount = buf.readInt32LE(body + 40);
      const partsAt = body + 44;
      const pointsAt = partsAt + partCount * 4;

      const starts = new Array(partCount);
      for (let i = 0; i < partCount; i++) starts[i] = buf.readInt32LE(partsAt + i * 4);

      const parts = [];
      for (let i = 0; i < partCount; i++) {
        const from = starts[i];
        const to = i + 1 < partCount ? starts[i + 1] : pointCount;
        if (to - from < 2) continue; // a single point is not a line
        const line = new Array(to - from);
        for (let p = from; p < to; p++) {
          const at = pointsAt + p * 16;
          line[p - from] = [buf.readDoubleLE(at), buf.readDoubleLE(at + 8)];
        }
        parts.push(line);
      }
      if (parts.length) out.push({ index, parts });
    } else if (type !== SHAPE_NULL) {
      // A roads download should be pure PolyLine; anything else means we were handed the
      // wrong layer (e.g. AREAWATER polygons), which is worth failing loudly on.
      throw new Error(`Unexpected shapefile geometry type ${type} — expected PolyLine (3)`);
    }

    cursor = body + contentBytes;
    index += 1;
  }
  return out;
};

// The pair above, joined and filtered to what the turf cut needs.
// Returns [{ coords, walkable, addressable, name }] — `coords` is one open line string.
export const readRoads = (shpBuf, dbfBuf) => {
  const attrs = readDbf(dbfBuf, ['MTFCC', 'FULLNAME']);
  const roads = [];
  for (const shape of readPolylines(shpBuf)) {
    const a = attrs[shape.index];
    const mtfcc = a?.MTFCC || '';
    if (!WALKABLE_MTFCC.has(mtfcc)) continue;
    for (const coords of shape.parts) {
      roads.push({
        coords,
        walkable: true,
        addressable: ADDRESSABLE_MTFCC.has(mtfcc),
        name: a?.FULLNAME || '',
      });
    }
  }
  return roads;
};
