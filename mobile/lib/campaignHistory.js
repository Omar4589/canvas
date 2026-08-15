import { formatGoalDate } from './goalPace';

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
// nothing is. A door goal moving DOWN and the invoice policy changing are the two edits someone
// might want to explain later — the rest are ordinary campaign upkeep.
export function isNotable(item) {
  if (item.kind === 'team') return !!item.restampError;
  if (item.field === 'billRestrictedDoors') return true;
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

// An actor whose account is deactivated or deleted still gets named — the server's
// hydrateCanvassers never drops an id — but the feed says so, because "Lee Lead did this" reads
// differently when Lee left in March. Folded into the sub line rather than given a pill: mobile's
// StatusPill is hard-coded to DOOR statuses, and this is not one.
export function actorLabel(person) {
  if (!person) return 'Unknown user';
  const name = person.name || 'Unknown user';
  return person.status && person.status !== 'active' ? `${name} (${person.status})` : name;
}
