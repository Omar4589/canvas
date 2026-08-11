// The mobile Export Center's type metadata + wire-params builder.
//
// The 4-id scope is the owner's mobile decision (survey answers (detailed), filtered voters,
// voter notes, and the full-backup ZIP stay on the web dashboard). The copy here is a
// FALLBACK: the server registry is canonical
// (GET /admin/exports/types serves label/desc/oneRowIs/filters straight from
// services/export/exportTypes.js) and mergeTypeMeta lays it over these strings when it
// responds — so the screen renders instantly, an older server changes nothing, and the two
// pickers cannot drift once the endpoint is live. `sub` (the one-line row subtitle) and
// `contents` (the sheet's "In the file" line) are mobile-only and always local.
export const EXPORT_TYPE_META = [
  {
    id: 'canvass-activity',
    emoji: '🚪',
    label: 'Canvassing activity',
    sub: 'Every door result, with the voter at that door',
    desc: 'Every door result: who knocked, when, the outcome, and the voter at that door. Voter columns (State voter ID, UID, name, party) fill in only when the event named a voter — a survey at the door; plain knocks (not home, refused, lit drop) are door-level records and leave them blank.',
    oneRowIs: 'one door event — who knocked, when, and the outcome',
    contents:
      'Timestamps in the campaign’s time zone, address, voter identity (State voter ID, UID, name, party — when a survey named the voter), canvasser and team, walk list and round, GPS, and the note.',
    filters: ['date', 'effort', 'pass', 'canvasser'],
  },
  {
    id: 'doors-by-round',
    emoji: '🔁',
    label: 'Doors by round',
    sub: 'One row per door per round, with its status',
    desc: 'One row per door per round with its status — filter it to "not home" and you have a re-knock list. A household file: it deliberately has no voter columns; use Canvassing activity for who was reached.',
    oneRowIs: 'one door in one round, with its round status and visit count',
    contents:
      'Walk list and round, address, round status, visit count, who knocked last and when, and whether the door is still active.',
    filters: ['effort', 'pass', 'roundStatus'],
  },
  {
    id: 'survey-results',
    emoji: '📊',
    label: 'Survey results',
    sub: 'One row per survey taken, one column per question',
    desc: 'One row per survey taken, one column per question. A voter surveyed again in a later round is another row. If the campaign ran more than one survey, you get one file per survey.',
    oneRowIs: 'one survey taken, one column per question',
    contents:
      'Submission time, voter identity (State voter ID, UID, name, party), address, canvasser and team, walk list and round, and one column per survey question. Contact and demographic columns are opt-in below.',
    filters: ['date', 'effort', 'pass', 'canvasser', 'voterDetail'],
  },
  {
    id: 'voter-file',
    emoji: '🗂️',
    label: 'Voter file',
    sub: 'Everyone currently in the campaign',
    desc: 'Your voter file, rebuilt from the data currently in Doorline — optionally using an import’s own vendor column names. Includes State Voter ID and UID for re-matching on another platform.',
    oneRowIs: 'one voter currently in the campaign',
    contents:
      'Every standard voter column — State Voter ID, UID, name, party, contact info, districts, address — or the exact column names from one of your uploads.',
    filters: ['import'],
  },
];

export const ROUND_STATUSES = ['unknocked', 'not_home', 'wrong_address', 'refused', 'surveyed', 'lit_dropped', 'restricted', 'no_soliciting'];

// Lay the server registry's copy over the local fallback, keyed by id. Server label /
// desc / oneRowIs / filters win; mobile-only fields (emoji, sub, contents) stay local.
export function mergeTypeMeta(serverTypes) {
  const byId = new Map((serverTypes || []).map((t) => [t.id, t]));
  return EXPORT_TYPE_META.map((meta) => {
    const s = byId.get(meta.id);
    if (!s) return meta;
    return {
      ...meta,
      label: s.label || meta.label,
      desc: s.desc || meta.desc,
      oneRowIs: s.oneRowIs || meta.oneRowIs,
      filters: Array.isArray(s.filters) && s.filters.length ? s.filters : meta.filters,
    };
  });
}

// Mirror of the web page's paramsForCreate: only non-empty filters go on the wire, and the
// SAME params feed both POST /admin/exports/estimate and POST /admin/exports — what the
// preview counted is what the queue builds.
export function paramsFor(meta, { range, effortId, passId, userId, roundStatus, importJobId, includeVoterDetail }) {
  const wants = (f) => (meta.filters || []).includes(f);
  const p = {};
  if (wants('date') && range && (range.from || range.to)) {
    if (range.from) p.from = range.from;
    if (range.to) p.to = range.to;
  }
  if (wants('effort') && effortId) p.effortId = effortId;
  if (wants('pass') && passId) p.passId = passId;
  if (wants('canvasser') && userId) p.userId = userId;
  if (wants('roundStatus') && roundStatus) p.roundStatuses = [roundStatus];
  if (wants('import') && importJobId) p.importJobId = importJobId;
  // Columns only — it never changes the row count, so the estimate is unaffected. It still
  // rides the wire params so what the sheet previewed is exactly what the queue builds.
  if (wants('voterDetail') && includeVoterDetail) p.includeVoterDetail = true;
  return p;
}
