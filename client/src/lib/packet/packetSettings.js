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
  // Ruled lines under each door. Measured: 2 -> 4 costs ~5 pages across a 200-door book,
  // so generosity here is close to free and people always want more room than you think.
  noteLines: 4,
  showOutcome: true,
  showPriorStatus: true,
  showScriptPage: true,
  showManifest: true,
  includePhone: false,
  inkSaver: false,
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
