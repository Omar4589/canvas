// Ink and type for the printed packet. A PDF is always light, so these are print-friendly
// literals rather than the runtime CSS tokens — but the brand red is the REAL one from
// index.css:32 (--brand: 220 38 38).
//
// Deliberately NOT imported from lib/reportPdf.js: its ACCENT_HEX.brand is #4f46e5 (indigo),
// which predates the red brand and would put the wrong colour on every sheet. Its NEUTRALS
// are correct and are mirrored here.

export const BRAND = [220, 38, 38]; // #DC2626
export const DARK = [17, 24, 39]; // #111827
export const GRAY = [107, 114, 128]; // #6B7280 — 4.83:1 on white, passes AA
// #9CA3AF — 2.54:1 on white, BELOW the 4.5:1 AA floor. Reserved for the two footer strings
// that are skim-only (printed-on date, the print-only notice). Anything a volunteer has to
// READ — a pen instruction, a field label, a page number — uses GRAY (4.83:1) instead.
export const SUBTLE = [156, 163, 175];
export const RULE = [229, 231, 235]; // #E5E7EB
// #D1D5DB — 1.47:1, and deliberately so: this is what a volunteer writes OVER, not something
// they read. A darker rule competes with their own handwriting.
export const HAIRLINE = [209, 213, 219];
export const WHITE = [255, 255, 255];

// Book stripe colours. These are the SAME twelve hues, in the SAME order, as
// `BOOK_COLORS` in client/src/pages/TurfsPage.jsx:34 — so a book is one colour on the Turf
// Cutting map, in the studio's picker and map, and on the printed stripe.
//
// That is only true if the INDEX agrees too. The index is assigned by the SERVER
// (`colorIndex`, from the book's position within its pass in creation order) and every
// surface reads it rather than using its own array position — a picker sorted by name and a
// map sorted by createdAt otherwise hand the same book two different colours.
export const BOOK_COLORS = [
  [37, 99, 235], [22, 163, 74], [219, 39, 119], [234, 88, 12],
  [124, 58, 237], [8, 145, 178], [202, 138, 4], [220, 38, 38],
  [5, 150, 105], [147, 51, 234], [13, 148, 136], [225, 29, 72],
];

// The same list as CSS hex, for the on-screen picker and map (which need strings, not
// triplets). Derived so the two can never drift.
export const BOOK_COLOR_HEX = BOOK_COLORS.map(
  ([r, g, b]) => `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
);

// Prior-round status pill ink. Keyed to Household.status values.
export const STATUS_INK = {
  not_home: [180, 83, 9],
  refused: [185, 28, 28],
  wrong_address: [120, 113, 108],
  surveyed: [21, 128, 61],
  lit_dropped: [29, 78, 216],
  restricted: [109, 40, 217],
};
export const STATUS_LABEL = {
  not_home: 'NOT HOME',
  refused: 'REFUSED',
  wrong_address: 'WRONG ADDRESS',
  surveyed: 'SURVEYED',
  lit_dropped: 'LIT DROPPED',
  restricted: 'RESTRICTED',
};

// Page geometry, in points (1/72"). US Letter portrait. The derived values are spelled out
// rather than assigned afterwards — the object is frozen, and a late `PAGE.X = …` throws.
//
// HEADER is 68, not 54: the band carries a WALKED BY / DATE write-in, and at 54 its rule
// landed 2pt above the first address — the name line and door 1 read as one crowded block.
export const PAGE = Object.freeze({
  W: 612,
  H: 792,
  MARGIN: 48,
  HEADER: 68,
  FOOTER: 22,
  CONTENT_W: 612 - 48 * 2, // 516
  BODY_TOP: 48 + 68, // 116
  BODY_BOTTOM: 792 - 48 - 22, // 722
  USABLE: 792 - 48 - 22 - (48 + 68), // 606
});

// The type scale. Every size on the sheet comes from here — nothing is set inline.
export const TYPE = Object.freeze({
  addressLine1: 13.5,
  addressMeta: 9,
  seqNumber: 13,
  voterName: 11,
  voterNameCompact: 10.5,
  voterMeta: 8.5,
  questionLabel: 9,
  penVerb: 8.5, // the instruction for how to answer — must be readable, not decorative
  option: 8.5,
  gate: 8,
  micro: 8,
  headerCampaign: 10,
  headerOrg: 7.5,
  headerBook: 11,
  headerMeta: 8,
  plate: 12,
  footer: 7.5,
  // The cover's hierarchy: the RACE is the masthead, the book is the identifier under it.
  // A volunteer already knows which campaign they turned up for — but a packet found later,
  // or a table holding two campaigns' packets, is answered by the race name first.
  coverCampaign: 25,
  coverOrg: 11,
  coverBook: 15,
  coverTitle: 24,
  coverPlate: 22,
  coverBody: 10,
});

// The Doorline pin, transcribed from client/src/components/Logo.jsx as vector path ops so
// it prints crisp at any size and embeds no raster asset. doc.path() emits geometry only —
// its `style` argument is ignored by the implementation, so the caller MUST follow with an
// explicit fill write or the mark renders as nothing.
export const drawDoorlinePin = (doc, x, y, h = 15) => {
  const s = h / 30;
  doc.setFillColor(...BRAND);
  doc.path([
    { op: 'm', c: [x + 12 * s, y] },
    { op: 'c', c: [x + 5.4 * s, y, x, y + 5.4 * s, x, y + 12 * s] },
    { op: 'c', c: [x, y + 20.4 * s, x + 12 * s, y + 30 * s, x + 12 * s, y + 30 * s] },
    { op: 'c', c: [x + 12 * s, y + 30 * s, x + 24 * s, y + 20.4 * s, x + 24 * s, y + 12 * s] },
    { op: 'c', c: [x + 24 * s, y + 5.4 * s, x + 18.6 * s, y, x + 12 * s, y] },
    { op: 'h' },
  ]);
  doc.internal.write('f');
  doc.setFillColor(...WHITE);
  doc.circle(x + 12 * s, y + 11.5 * s, 4.4 * s, 'F');
};
