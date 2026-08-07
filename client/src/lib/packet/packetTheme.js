// Ink and type for the printed packet. A PDF is always light, so these are print-friendly
// literals rather than the runtime CSS tokens — but the brand red is the REAL one from
// index.css:32 (--brand: 220 38 38).
//
// Deliberately NOT imported from lib/reportPdf.js: its ACCENT_HEX.brand is #4f46e5 (indigo),
// which predates the red brand and would put the wrong colour on every sheet. Its NEUTRALS
// are correct and are mirrored here.

export const BRAND = [220, 38, 38]; // #DC2626
export const DARK = [17, 24, 39]; // #111827
export const GRAY = [107, 114, 128]; // #6B7280
export const SUBTLE = [156, 163, 175]; // #9CA3AF
export const RULE = [229, 231, 235]; // #E5E7EB
export const HAIRLINE = [209, 213, 219]; // #D1D5DB — what a volunteer writes ON
export const WHITE = [255, 255, 255];

// Book stripe colours, matched to the Turfs map so twelve packets face-down on a folding
// table sort the same way the books do on screen.
export const BOOK_COLORS = [
  [124, 58, 237], [8, 145, 178], [202, 138, 4], [22, 163, 74],
  [219, 39, 119], [37, 99, 235], [234, 88, 12], [13, 148, 136],
  [147, 51, 234], [190, 24, 93], [5, 150, 105], [161, 98, 7],
];

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
export const PAGE = Object.freeze({
  W: 612,
  H: 792,
  MARGIN: 48,
  HEADER: 54,
  FOOTER: 22,
  CONTENT_W: 612 - 48 * 2, // 516
  BODY_TOP: 48 + 54, // 102
  BODY_BOTTOM: 792 - 48 - 22, // 722
  USABLE: 792 - 48 - 22 - (48 + 54), // 620
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
  penVerb: 7.5,
  option: 8.5,
  gate: 8,
  micro: 7.5,
  headerCampaign: 10,
  headerOrg: 7.5,
  headerBook: 11,
  headerMeta: 8,
  plate: 12,
  footer: 7.5,
  coverTitle: 24,
  coverPlate: 28,
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
