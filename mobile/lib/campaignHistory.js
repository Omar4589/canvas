import { formatGoalDate } from './goalPace';
import { ACTION_LABELS } from './theme';

// Words for the campaign change feed. The SERVER stores field keys and raw before/after values
// (server/src/models/CampaignChange.js); everything human lives here, so re-wording a label is
// never a data migration and an old row always renders with today's copy.
//
// Mirrored BY HAND from client/src/lib/campaignHistory.js, the same rule goalPace.js and
// metricHelp.js follow: reword one, reword both.
//
// ONE DELIBERATE DIVERGENCE from the web file: it formats the date fields with `formatDateLabel`
// from electionDates.js, which mobile's electionDates.js does not export. `formatGoalDate` from
// goalPace.js does the identical UTC-parse-and-format trick and produces the same 'Oct 28' shape,
// so the rendered output matches — only the import differs.

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
  // Walk-list and pass lifecycle rows (source 'walk_list_lifecycle'). Each reads as one sentence
  // (walkListSentence below); a label shows only on a row without usable details.
  walkListArchived: 'Walk list archived',
  walkListUnarchived: 'Walk list unarchived',
  passArchived: 'Pass archived',
  passBroughtBack: 'Pass brought back',
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
  if (DATE_FIELDS.has(field)) return formatGoalDate(value);
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
//
// `doorsMoved` is doors (knocks, deduplicated); a server that predates it sends only activitiesMoved,
// which it folds the doors into. A move of surveys or notes alone says so rather than "0 doors". A
// change that didn't finish says what it was moving, and one a later change finished says that.
export function teamMoveSummary(item) {
  const from = item.fromCoordinator?.name || 'No coordinator';
  const to = item.toCoordinator?.name || 'No coordinator';
  const toTeam = to === 'No coordinator' ? 'no team' : to;
  const doors = item.doorsMoved ?? item.activitiesMoved ?? 0;
  const surveys = item.surveysMoved || 0;
  const rows = item.rowsMoved ?? item.activitiesMoved ?? 0;
  const count = (k, one, many) => `${k.toLocaleString()} ${k === 1 ? one : many}`;
  const what = doors ? count(doors, 'door', 'doors') : surveys ? count(surveys, 'survey', 'surveys') : rows ? 'notes and marks' : null;
  let detail;
  if (!what) detail = 'No recorded work moved with them';
  else if (item.restampError) detail = `Didn't finish moving ${what} to ${toTeam}`;
  else detail = `${what.charAt(0).toUpperCase()}${what.slice(1)} moved to ${toTeam}`;
  if (item.finishedBy) detail += ' · Finished by a later change';
  return { headline: `${item.user?.name || 'Someone'}: ${from} → ${to}`, detail };
}

// An actor whose account is deactivated or deleted still gets named — the server's
// hydrateCanvassers never drops an id — but the feed says so, because "Lee Lead did this" reads
// differently when Lee left in March. Folded into the sub line rather than given a pill: mobile's
// StatusPill is hard-coded to DOOR statuses, and this is not one. The History route names a row nobody
// made "One-time check" (the one-time walk-list repair) with no status, so it reads as the plain name —
// here and on phones without this code; 'system' is tolerated too.
export function actorLabel(person) {
  if (!person) return 'Unknown user';
  const name = person.name || 'Unknown user';
  return person.status && person.status !== 'active' && person.status !== 'system' ? `${name} (${person.status})` : name;
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

// The sentence for each walk-list lifecycle row, by field and then details.outcome, with the actor in
// front. `list` is the walk list's name, `pass` the pass's own words ("Pass 3 · GOTV", written by the
// server's passLabel). The same code is in client/src/lib/campaignHistory.js —
// client/src/lib/walkListSentence.parity.test.js holds the two in step.
const LIFECYCLE_SENTENCES = {
  walkListArchived: {
    ended: (who, list, pass) => `${who} archived walk list ${list} — ended ${pass}`,
    'nothing-live': (who, list) => `${who} archived walk list ${list}`,
  },
  walkListUnarchived: {
    'brought-back': (who, list, pass) => `${who} unarchived walk list ${list} — brought back ${pass}`,
    'stayed-ended': (who, list, pass) => `${who} unarchived walk list ${list} — ${pass} stayed ended`,
    'nothing-ended': (who, list) => `${who} unarchived walk list ${list}`,
  },
  passArchived: {
    'by-hand': (who, where) => `${who} archived ${where}`,
    repair: (who, where) => `${who} ended ${where}`,
  },
  passBroughtBack: {
    live: (who, where) => `${who} brought back ${where}`,
    draft: (who, where) => `${who} brought back ${where} as a draft`,
  },
};
// The two outcomes that name no pass: nothing was live to end, nothing had ended to bring back.
const NO_PASS_OUTCOMES = new Set(['nothing-live', 'nothing-ended']);

// One sentence for a walk-list or pass lifecycle row (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §C.9), built
// ONLY from the facts the server stores in `details` ({ walkList, pass, outcome }) with the fixed
// templates above — walk list and pass names are free text, so nothing is ever cut out of
// fromValue/toValue. The actor is the row's `by`, as on every row (the server names an actorless
// repair row "One-time check"). null when the row has no usable details — an outcome this copy doesn't
// know, say: the caller then shows the label and the from/to values, which the server writes readable
// for exactly that case.
//   "Ada archived walk list North — ended Pass 3 · GOTV"
//   "Ada unarchived walk list North — Pass 3 · GOTV stayed ended"
//   "One-time check ended North · Pass 3 · GOTV"
export const walkListSentence = (item) => {
  const d = item?.details;
  const template = d && LIFECYCLE_SENTENCES[item?.field]?.[d.outcome];
  if (!template) return null;
  const who = item.by?.name || 'Someone';
  const pass = d.pass ? String(d.pass) : null;
  if (item.field === 'walkListArchived' || item.field === 'walkListUnarchived') {
    if (!d.walkList || (!pass && !NO_PASS_OUTCOMES.has(d.outcome))) return null;
    return template(who, String(d.walkList), pass);
  }
  if (!pass) return null;
  // "North · Pass 3 · GOTV", or the pass alone if its walk list was gone when the row was written.
  const where = d.walkList ? `${d.walkList} · ${pass}` : pass;
  // The server names the actorless repair row "One-time check" (no id), so only a repair row carrying
  // someone else's name — or none — needs to say where it came from.
  const isCheck = item.by?.id == null && item.by?.name === 'One-time check';
  const fromRepair = d.outcome === 'repair' && !isCheck ? ' (one-time check)' : '';
  return `${template(who, where)}${fromRepair}`;
};
