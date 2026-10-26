import { formatDateLabel } from './electionDates.js';
import { ACTION_LABELS } from './statusColors.js';

// Words for the campaign change feed. The SERVER stores field keys and raw before/after values
// (models/CampaignChange.js); everything human lives here, so re-wording a label is never a data
// migration and an old row always renders with today's copy.

// Keys must match AUDITED_FIELDS in server/src/routes/admin/campaigns.js. A field the server logs
// but this map doesn't know still renders — see labelForField's fallback — so the two can't get
// out of sync in the direction that loses information.
const FIELD_LABELS = {
  doorGoal: 'Door goal',
  goalDate: 'Goal date',
  electionDay: 'Election Day',
  earlyVotingStart: 'Early voting start',
  earlyVotingEnd: 'Early voting end',
  datesNote: 'Key dates note',
  billRestrictedDoors: 'Restricted doors on invoices',
  isActive: 'Status',
  name: 'Campaign name',
  type: 'Campaign type',
  state: 'State',
  disabledOutcomes: 'Door outcomes',
  enabledOutcomes: 'Off-by-default outcomes',
  doorAddPolicy: 'Adding people at the door',
  outcomeReclassify: 'Reclassified entries',
  // The Door Outcomes acts that rewrite recorded history. Not schema paths: each tool writes its
  // own key (models/CampaignChange.js).
  surveyConversion: 'Surveyed entries',
  unknock: 'Entries',
  answerEdit: 'Survey answers edited',
  answerEditUndo: 'Survey answer edit undone',
};

const DATE_FIELDS = new Set(['goalDate', 'electionDay', 'earlyVotingStart', 'earlyVotingEnd']);

// A field key we don't have copy for turns into a readable guess rather than disappearing:
// 'someNewField' → 'Some new field'.
export function labelForField(field) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const spaced = String(field || '').replace(/([A-Z])/g, ' $1').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// The visible before/after. Every field's `null` means something different — "no goal", "no date",
// "inherit the org default" — so each one says its own thing rather than all reading "none".
export function formatValue(field, value) {
  if (field === 'billRestrictedDoors') {
    if (value === true) return 'counted';
    if (value === false) return 'not counted';
    return 'organization default';
  }
  if (field === 'isActive') return value === false ? 'Archived' : 'Active';
  if (field === 'type') return value === 'lit_drop' ? 'Lit drop' : 'Survey';
  // Before the null fallback: here null means "nothing is off", not "not set". The server
  // stores a sorted comma-join of action keys ('refused,restricted').
  if (field === 'disabledOutcomes') {
    if (!value) return 'all on';
    return `${String(value).split(',').map((k) => ACTION_LABELS[k] || k).join(', ')} off`;
  }
  // The opt-in class: null means nothing extra is on (every campaign is born that way).
  if (field === 'enabledOutcomes') {
    if (!value) return 'none';
    return String(value).split(',').map((k) => ACTION_LABELS[k] || k).join(', ');
  }
  // 'all' is the schema default, so anything but 'leads' reads as it.
  if (field === 'doorAddPolicy') return value === 'leads' ? 'Team leads & admins only' : 'Everyone on the campaign';
  // Not a schema path: the outcome-reclassification tool writes the two outcome KEYS it folded
  // together, so the row reads "No soliciting → Not home" (and the reverse on a revert).
  if (field === 'outcomeReclassify') return ACTION_LABELS[value] || String(value ?? '');
  // A survey conversion stores the two outcome keys too ('mixed' for a selection spanning several).
  if (field === 'surveyConversion') return value === 'mixed' ? 'several outcomes' : ACTION_LABELS[value] || String(value ?? '');
  // Unknock stores 'recorded' / 'unknocked' (swapped on an undo).
  if (field === 'unknock') return value === 'unknocked' ? 'unknocked' : 'recorded';
  if (value === null || value === undefined || value === '') {
    return field === 'datesNote' ? 'empty' : 'not set';
  }
  if (field === 'doorGoal') return `${Number(value).toLocaleString()} doors`;
  if (DATE_FIELDS.has(field)) return formatDateLabel(value);
  if (field === 'datesNote') {
    const s = String(value);
    return `“${s.length > 60 ? `${s.slice(0, 60)}…` : s}”`;
  }
  return String(value);
}

// Which changes deserve to catch the eye. Deliberately short: if everything is highlighted,
// nothing is. A door goal moving DOWN, the invoice policy changing, an outcome being switched
// off, and an off-by-default outcome being switched on or off are the edits someone might want
// to explain later — the rest are ordinary campaign upkeep.
export function isNotable(item) {
  if (item.kind === 'team') return !!item.restampError;
  if (item.field === 'billRestrictedDoors') return true;
  if (item.field === 'disabledOutcomes') return true;
  if (item.field === 'enabledOutcomes') return true;
  // Rewriting recorded history always deserves the eye, in either direction.
  if (item.field === 'outcomeReclassify') return true;
  if (item.field === 'surveyConversion' || item.field === 'unknock') return true;
  if (item.field === 'answerEdit' || item.field === 'answerEditUndo') return true;
  if (item.field === 'doorGoal') {
    const from = Number(item.fromValue);
    const to = Number(item.toValue);
    return Number.isFinite(from) && Number.isFinite(to) && to < from;
  }
  return false;
}

// One sentence for a team-reassignment row. The doors-moved count is the point: a by-team number
// can move without anyone knocking a door, and this is what explains it.
export function teamMoveSummary(item) {
  const from = item.fromCoordinator?.name || 'No coordinator';
  const to = item.toCoordinator?.name || 'No coordinator';
  const moved = (item.activitiesMoved || 0) + (item.surveysMoved || 0);
  const doors = item.activitiesMoved || 0;
  return {
    headline: `${item.user?.name || 'Someone'}: ${from} → ${to}`,
    detail: moved
      ? `${doors.toLocaleString()} ${doors === 1 ? 'door' : 'doors'} moved to ${to === 'No coordinator' ? 'no team' : to}`
      : 'No recorded work moved with them',
  };
}

// One sentence for an answer-edit row (and its undo), instead of "changed from … to …": the
// server froze the words when the change ran — the survey's own wording and the real counts —
// which a label built now could not rebuild.
//   "Survey answers edited: Could you help us by taking a yard sign? — took out … (214 surveys)"
//   "Survey answer edit undone: 212 surveys put back, 2 kept newer answers"
export const answerEditSentence = (item) => {
  if (item.field === 'answerEditUndo') {
    return { headline: 'Survey answer edit undone', detail: `${item.toValue || ''}${item.fromValue ? ` — ${item.fromValue}` : ''}` };
  }
  return { headline: 'Survey answers edited', detail: String(item.toValue || '') };
};

// ── The Client Reports tab's History (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F9) ─────────────────
// Rows with source 'client_report': a report's life (clientReport.*), a team's (clientReportSeries.*)
// and a client link's (reportLink.*). WEB ONLY: the campaign feed the phone reads filters these rows
// out on the server, so mobile/lib/campaignHistory.js has nothing to mirror here. A report row names
// the report's PERIOD (periodLabel) and its tab, never its title; a team's row names the team; an
// edit row keeps only the EARLIER text, which an admin can erase; a link row never holds the URL or a
// password.

const REPORT_ROW = {
  'clientReport.created': 'Draft created',
  'clientReport.published': 'Published',
  'clientReport.edited': 'Edited',
  'clientReport.numbersRefreshed': 'Numbers refreshed',
  'clientReport.refreshDiscarded': 'New numbers discarded',
  'clientReport.takenDown': 'Taken down',
  'clientReport.putBackUp': 'Put back up',
  'clientReport.deleted': 'Deleted',
  'clientReport.remapped': 'Switched to areas',
};
const SERIES_ROW = {
  'clientReportSeries.created': 'Team created',
  'clientReportSeries.renamed': 'Renamed',
  'clientReportSeries.crewsChanged': 'Crews changed',
  'clientReportSeries.ended': 'Team ended',
  'clientReportSeries.continued': 'Team continued',
};
const LINK_ROW = {
  'reportLink.created': 'Link created',
  'reportLink.passwordChanged': 'Link password changed — everyone was signed out',
  'reportLink.rotated': 'Link rotated — new address, everyone was signed out',
  'reportLink.renewed': 'Expired link renewed — new address',
  'reportLink.extended': 'Link extended',
  'reportLink.disabled': 'Link disabled — everyone was signed out',
  'reportLink.enabled': 'Link enabled',
  'reportLink.wrongPasswords': 'Wrong passwords on a link',
  'reportLink.locked': 'Link locked after 50 wrong passwords',
  'reportLink.unlocked': 'Link unlocked',
  'reportLink.deleted': 'Link deleted',
};

export const isClientReportField = (field) => !!(REPORT_ROW[field] || SERIES_ROW[field] || LINK_ROW[field]);

const count = (n) => Number(n || 0).toLocaleString();
const quoted = (s) => `“${String(s).length > 60 ? `${String(s).slice(0, 60)}…` : String(s)}”`;
const sections = (n) => `${n} ${n === 1 ? 'section' : 'sections'}`;
const crews = (n) => `${n} ${n === 1 ? 'crew' : 'crews'}`;

// "Doors 3,412 → 3,420 · Surveys 1,980 → 1,983": only the cards that moved, or "no totals moved".
const refreshDetail = (from, to) => {
  const cards = [
    ['doorsKnocked', 'Doors'],
    ['surveysTaken', 'Surveys'],
    ['surveyedVoters', 'Voters surveyed'],
    ['litKnocks', 'Lit dropped'],
  ];
  const moved = cards
    .filter(([k]) => (from?.[k] ?? 0) !== (to?.[k] ?? 0))
    .map(([k, label]) => `${label} ${count(from?.[k])} → ${count(to?.[k])}`);
  return moved.length ? moved.join(' · ') : 'No totals moved';
};

// What an edit row kept: the earlier title and/or notes, as the drawer previews them.
export const earlierTextSummary = (fromValue) => {
  if (!fromValue) return '';
  const parts = [];
  if (typeof fromValue.title === 'string') parts.push(`Earlier title: ${fromValue.title ? quoted(fromValue.title) : 'none'}`);
  if (Array.isArray(fromValue.observations)) parts.push(`Earlier notes: ${fromValue.observations.length ? sections(fromValue.observations.length) : 'none'}`);
  return parts.join(' · ');
};

const valueLabel = (v) => (v && typeof v === 'object' ? v.label : typeof v === 'string' ? v : null);

// The tab a row belongs to, by its series' CURRENT name (`seriesLabels`: series id → label, from the
// campaign's series list) — or null for a row with no series, or one the list doesn't hold.
const tabOf = (item, seriesLabels) => (item.seriesId && seriesLabels?.get(String(item.seriesId))) || null;

/**
 * A report row's name without the word "report": its period and its tab — "Oct 13 – Oct 19, 2026 ·
 * Paid team" — so four tabs' publishes of one week read apart (WALK-3). The period alone on a row
 * with no tab; null with neither.
 */
export const reportRowName = (item, seriesLabels = null) => {
  const tab = tabOf(item, seriesLabels);
  if (item.periodLabel) return tab ? `${item.periodLabel} · ${tab}` : item.periodLabel;
  return tab;
};

/**
 * One row of the Client Reports History, as { headline, subject, detail }:
 *   subject  — what it is about: "Oct 13 – Oct 19, 2026 · Paid team report", "Paid team", or the
 *              link's label
 *   headline — what happened: "Published", "Crews changed", "Link rotated — new address, …"
 *   detail   — the specifics, or '' (the earlier text itself is rendered by the drawer)
 * `seriesLabels` (series id → current label) names the tab of a report row, and the team of a series
 * row written before rows named it themselves (an old "Team ended" or "Crews changed").
 */
export const clientReportHistoryLine = (item, { seriesLabels = null } = {}) => {
  const f = item.field;
  if (REPORT_ROW[f]) {
    const name = reportRowName(item, seriesLabels);
    const subject = name ? `${name} report` : 'A report';
    let detail = '';
    if (f === 'clientReport.edited') {
      if (item.erasedAt) detail = 'Earlier text erased';
      else if (item.fromValue) detail = earlierTextSummary(item.fromValue);
      else detail = 'What it shows changed (questions, tags, goal or map) — no text was replaced';
    } else if (f === 'clientReport.numbersRefreshed') {
      detail = refreshDetail(item.fromValue, item.toValue);
    } else if (f === 'clientReport.remapped') {
      detail = item.toValue?.areaSize === 'large' ? 'Large areas' : 'Small areas';
    }
    return { headline: REPORT_ROW[f], subject, detail };
  }
  if (SERIES_ROW[f]) {
    // The name the row was written with (toValue.label, WALK-3), else the team's current name.
    let subject = valueLabel(item.toValue) || valueLabel(item.fromValue) || tabOf(item, seriesLabels) || 'A team';
    let detail = '';
    if (f === 'clientReportSeries.renamed') {
      subject = valueLabel(item.toValue) || 'A tab';
      detail = `${quoted(valueLabel(item.fromValue) || '')} → ${quoted(valueLabel(item.toValue) || '')}`;
    } else if (f === 'clientReportSeries.created' || f === 'clientReportSeries.continued') {
      const n = (item.toValue?.coordinatorIds || []).length;
      detail = n ? crews(n) : '';
    } else if (f === 'clientReportSeries.crewsChanged') {
      const a = item.fromValue || {};
      const b = item.toValue || {};
      detail = `${crews((a.coordinatorIds || []).length)} → ${crews((b.coordinatorIds || []).length)}`;
      const past = (b.pastCoordinatorIds || []).length;
      if (past) detail += ` · past doors kept for ${crews(past)}`;
    }
    return { headline: SERIES_ROW[f], subject, detail };
  }
  if (LINK_ROW[f]) {
    const subject = valueLabel(item.toValue) || valueLabel(item.fromValue) || 'A client link';
    let detail = '';
    if (f === 'reportLink.wrongPasswords') {
      const n = item.toValue?.count ?? item.toValue?.failures ?? null;
      if (n != null) detail = `${count(n)} wrong passwords`;
    } else if (f === 'reportLink.unlocked' && item.toValue?.cleared) {
      detail = `${count(item.toValue.cleared)} wrong passwords cleared`;
    } else if (f === 'reportLink.passwordChanged' && item.toValue?.wasOpenLink) {
      detail = 'A password was added to an open link';
    } else if (f === 'reportLink.deleted' && item.toValue?.reportDeleted) {
      // A link to just one report goes with its report (PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D, Cascade).
      detail = 'Deleted with its report';
    } else if (f === 'reportLink.locked' && item.toValue?.until) {
      const until = new Date(item.toValue.until);
      if (!Number.isNaN(until.getTime())) detail = `Locked until ${until.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    } else if (f === 'reportLink.extended' || f === 'reportLink.renewed' || f === 'reportLink.created') {
      // An instant: shown as a date on the reader's own calendar (the drawer is operator-only).
      const until = item.toValue?.expiresAt ? new Date(item.toValue.expiresAt) : null;
      if (until && !Number.isNaN(until.getTime())) {
        detail = `Expires ${until.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
      }
    }
    return { headline: LINK_ROW[f], subject, detail };
  }
  return { headline: labelForField(f), subject: '', detail: '' };
};

/** Client-report rows worth the eye: a report taken down or deleted, a link under attack. */
export const isNotableClientReportRow = (item) =>
  ['clientReport.takenDown', 'clientReport.deleted', 'reportLink.locked', 'reportLink.wrongPasswords'].includes(item.field);
