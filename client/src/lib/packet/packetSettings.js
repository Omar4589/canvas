// What the admin can change about a printed packet, and what it costs in paper.
//
// `layout` is the one decision that reshapes the page:
//   'survey'  — the campaign's questions beside every door, to circle and tick
//   'field'   — no questions at all: address, residents, outcome, room to write
// Everything else is shared between them.

export const LAYOUTS = [
  {
    id: 'survey',
    label: 'Survey packet',
    hint: 'Every question, with options to circle. Use when you want the answers back.',
    needsSurvey: true,
  },
  {
    id: 'field',
    label: 'Field list',
    hint: 'No questions — just addresses, residents, and lines to write on.',
    needsSurvey: false,
  },
];

export const DEFAULT_SETTINGS = Object.freeze({
  layout: 'survey',
  // Ruled lines under each door, now at a 20pt (college-ruled) pitch. THREE real lines beat
  // the four unwritable ones this used to default to — at 12pt they were 4.23mm apart.
  noteLines: 3,
  // Pad each packet to an even page count so every cover lands on a FRESH SHEET. Without it a
  // duplexed run fuses the end of one book to the start of the next on a single piece of paper.
  duplex: true,
  // How a multi-packet run downloads. 'single' — one PDF, one click prints the whole run
  // (safe front-and-back because of the duplex padding above). 'zip' — one PDF per packet
  // plus the hand-out sheet, for handing each volunteer their own file. A one-packet run is
  // always a single PDF either way.
  downloadAs: 'single',
  showOutcome: true,
  showPriorStatus: true,
  showScriptPage: true,
  showManifest: true,
  // A basemap of the book with the walk drawn over it, on the cover. Needs MAPBOX_PUBLIC_TOKEN;
  // silently absent without one.
  showCoverMap: true,
  includePhone: false,
  excludeApartments: false,
  inkSaver: false,
  // Split big books into ~N-door printed packets ("Book 33 · 2 of 4"). 0 = off: whole books,
  // exactly as before the knob existed. Print-time only — the split never touches the book.
  doorsPerPacket: 0,
});

const KEY = (campaignId) => `packetSettings:${campaignId}`;

export const loadSettings = (campaignId) => {
  try {
    const raw = localStorage.getItem(KEY(campaignId));
    if (!raw) return { ...DEFAULT_SETTINGS };
    const saved = JSON.parse(raw);
    // Merge onto the defaults so a setting added later is never `undefined` at render time.
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveSettings = (campaignId, settings) => {
  try {
    localStorage.setItem(KEY(campaignId), JSON.stringify(settings));
  } catch {
    // A full or blocked localStorage must never stop someone printing.
  }
};

// A campaign with no survey configured cannot print the survey layout — fall back rather
// than rendering a packet whose questions are all missing.
export const resolveLayout = (settings, hasSurvey) =>
  settings.layout === 'survey' && !hasSurvey ? 'field' : settings.layout;

export const sheetsFor = (pages) => Math.ceil(pages / 2);
