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
    label: 'Canvassing activity',
    sub: 'Every door result, with the voter at that door',
    desc: 'Every door result: who knocked, when, the outcome, and the voter at that door. Voter columns (State voter ID, UID, name, party) fill in only when the event named a voter — a survey at the door; plain knocks (not home, refused, lit drop) are door-level records and leave them blank. Flip "One row per voter at the door" and those knocks repeat once per registered voter at that address — same columns, more rows, the same outcome on each — in a file whose name includes -by-voter.',
    oneRowIs: 'one door event — who knocked, when, and the outcome',
    contents:
      'Timestamps in the campaign’s time zone, address, voter identity (State voter ID, UID, name, party — when a survey named the voter, or every registered voter with "One row per voter" on), canvasser and team, walk list and round, GPS, and the note. With "Include survey answers" on it also carries what each survey recorded, one column per question, plus a row for every survey the knock ledger cannot show.',
    // NOT 'onePerKnock' (docs/PROPOSAL_ONE_ROW_PER_KNOCK.md): that switch shows only when the server's
    // type list advertises it. This fallback is used when /types fails, and an older server would drop
    // the param silently — the phone would promise a per-knock file and queue a plain one.
    filters: ['date', 'effort', 'pass', 'canvasser', 'outcome', 'perVoterRows', 'surveyAnswers'],
  },
  {
    id: 'doors-by-round',
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
    label: 'Voter file',
    sub: 'Everyone currently in the campaign',
    desc: 'Your voter file, rebuilt from the data currently in Doorline — optionally using an import’s own vendor column names. Includes State Voter ID and UID for re-matching on another platform.',
    oneRowIs: 'one voter currently in the campaign',
    contents:
      'Every standard voter column — State Voter ID, UID, name, party, contact info, districts, address — or the exact column names from one of your uploads.',
    filters: ['import'],
  },
];

// not_target (the off-by-default outcome) is appended per campaign by the export sheet — offered
// only where the campaign has used it, like the web Exports page.
export const ROUND_STATUSES = ['unknocked', 'not_home', 'wrong_address', 'refused', 'surveyed', 'lit_dropped', 'restricted', 'no_soliciting'];

// Lay the server registry's copy over the local fallback, keyed by id. Server label /
// desc / descNotTargetInUse / oneRowIs / filters win; mobile-only fields (sub, contents) stay
// local.
export function mergeTypeMeta(serverTypes) {
  const byId = new Map((serverTypes || []).map((t) => [t.id, t]));
  return EXPORT_TYPE_META.map((meta) => {
    const s = byId.get(meta.id);
    if (!s) return meta;
    return {
      ...meta,
      label: s.label || meta.label,
      desc: s.desc || meta.desc,
      // The copy that names Not a target voter — the export sheet shows it only on a campaign that
      // uses the outcome (useOutcomeInUse). `desc` never names it.
      descNotTargetInUse: s.descNotTargetInUse || null,
      oneRowIs: s.oneRowIs || meta.oneRowIs,
      filters: Array.isArray(s.filters) && s.filters.length ? s.filters : meta.filters,
    };
  });
}

// Mirror of the web page's paramsForCreate: only non-empty filters go on the wire, and the
// SAME params feed both POST /admin/exports/estimate and POST /admin/exports — what the
// preview counted is what the queue builds.
export function paramsFor(meta, { range, effortId, passId, userId, roundStatus, importJobId, actionTypes, includeVoterDetail, perVoterRows, includeSurveyAnswers, onePerKnock }) {
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
  // ROWS too, and it renames the file. Before the chips: it decides which of them can ride along.
  if (wants('onePerKnock') && onePerKnock) p.onePerKnock = true;
  // Door-outcome chips: an empty selection is "every outcome", never "match nothing". Narrowed by the
  // same rule the sheet renders its chips with, so a chip hidden while One row per knock is on stays in
  // state and rides nowhere (the web page's rule) — the server's 400 for it is unreachable.
  if (wants('outcome') && actionTypes?.length) {
    const kept = actionTypes.filter((a) => !p.onePerKnock || !NOT_KNOCK_OUTCOMES.includes(a));
    if (kept.length) p.actionTypes = kept;
  }
  // Columns only — includeVoterDetail never changes the row count, so the estimate ignores it.
  // It still rides the wire params so what the sheet previewed is exactly what the queue builds.
  if (wants('voterDetail') && includeVoterDetail) p.includeVoterDetail = true;
  // ROWS — the one option that DOES move the row count (and renames the file), which is exactly
  // why it rides the same wire: the sheet's live estimate reads it and shows the fanned count.
  if (wants('perVoterRows') && perVoterRows) p.perVoterRows = true;
  // Also ROWS — it attaches answers AND adds a row for every survey the household-deduped knock
  // ledger cannot represent, so the live estimate reads it exactly like the fan.
  if (wants('surveyAnswers') && includeSurveyAnswers) p.includeSurveyAnswers = true;
  return p;
}

// ── One row per knock (docs/PROPOSAL_ONE_ROW_PER_KNOCK.md) ────────────────────────────────────

// Not knocks: a Restricted mark and a note. One row per knock lists knocks only.
export const NOT_KNOCK_OUTCOMES = ['restricted', 'note_added'];

// The ONE rule for which outcome chips the sheet offers: Not a target voter only where the campaign
// has used it, and no Restricted / Note added while One row per knock is on. paramsFor narrows by the
// same rule.
export const outcomeKeysFor = (meta, keys, { onePerKnock = false, notTargetInUse = false } = {}) => {
  const perKnock = !!onePerKnock && (meta?.filters || []).includes('onePerKnock');
  return keys.filter((k) => (k !== 'not_target' || notTargetInUse) && (!perKnock || !NOT_KNOCK_OUTCOMES.includes(k)));
};

// What a successful queue should remember, or null when this type carries nothing to remember. Only
// Include survey answers is remembered (One row per knock is ticked deliberately every time — the
// owner's ruling, 2026-11-09). Returning null for the other types fixes the old wipe: queueing Doors by
// round, Survey results or Voter file used to save includeSurveyAnswers: false over the choice.
export const optionsToRemember = (meta, params) => {
  if (!(meta?.filters || []).includes('surveyAnswers')) return null;
  return { includeSurveyAnswers: !!params?.includeSurveyAnswers };
};

// "N knocks + M more people surveyed" — the web's client/src/lib/exportSplit.js, hand-mirrored and held
// in step by client/src/lib/exportSplit.parity.test.js. Per-knock files only: their rows are knocks
// plus the survey rows after them. With One row per voter on too, the knock rows repeat per voter, so
// only the surveys are named.
const morePeople = (m) => (m === 1 ? '1 more person surveyed' : `${m.toLocaleString()} more people surveyed`);
export const knockSplitLine = ({ onePerKnock, perVoterRows } = {}, { rows, surveyRows } = {}) => {
  if (!onePerKnock) return null;
  const m = Number(surveyRows) || 0;
  if (m <= 0) return null;
  if (perVoterRows) return `includes ${morePeople(m)}`;
  const n = Math.max(0, (Number(rows) || 0) - m);
  return `${n.toLocaleString()} knock${n === 1 ? '' : 's'} + ${morePeople(m)}`;
};

// The export sheet's row-count line, from an estimate answer. `est.asked` is the params that answer was
// COUNTED for (the sheet attaches them in its queryFn): the sheet keeps the previous answer on screen
// through the debounce and the next fetch, so labelling by the live switches would call an old per-voter
// count "knocks" for a moment. Kept out of the component so it can be tested.
export const estimateLineFor = (est) => {
  if (!est) return null;
  // A per-knock count that hit its time cap has no honest floor, so the server sends no number.
  if (est.rowsUnavailable) return 'Row count not available for this one — you can still queue';
  // rowsAreFloor: the fanned count hit its time cap and the server answered with one row per knock —
  // a floor, never above the truth — so say so instead of printing it as ≈.
  const n = Number(est.rows || 0).toLocaleString();
  let first = est.rowsAreFloor ? `at least ${n} rows` : `≈ ${n} rows`;
  const asked = est.asked || {};
  if (asked.onePerKnock && est.surveyRows != null) {
    const split = knockSplitLine(asked, { rows: est.rows, surveyRows: est.surveyRows });
    if (asked.perVoterRows) first = split ? `≈ ${n} rows · ${split}` : `≈ ${n} rows`;
    else first = split ? `≈ ${split}` : `≈ ${n} knock${est.rows === 1 ? '' : 's'}`;
  }
  const bits = [first];
  if (est.dncWithheld > 0) bits.push(`${est.dncWithheld} withheld (do not contact)`);
  if (est.files?.length) bits.push(`${est.files.length} files — one per survey`);
  if (est.contentKind === 'zip') bits.push('ZIP');
  return bits.join(' · ');
};

// The export history line's One row per knock bits: it says so (the file name does too), and the split
// an owner sends a client.
export const perKnockJobBits = (job) => {
  if (!job?.params?.onePerKnock) return [];
  const split = knockSplitLine(job.params, { rows: job.rowCount, surveyRows: job.surveyRowCount });
  return split ? ['per knock', split] : ['per knock'];
};
