import { STATUS_LABELS } from './statusColors.js';

// Why the Turf Cutting map fades a door while a target filter is previewed — and the words for it.
//
// A faded dot used to mean five different things and say none of them: the door's all-rounds
// status isn't ticked, Exclude doors removed it, or one of the three boxes above Generate left it
// out (restricted, no soliciting, no reliable map spot). The server's preview now names the last
// four (`excludedHouseholdIds`, `leftOut.*` — routes/admin/turfs.js target-preview); a drawn door
// in none of those sets and not in `householdIds` faded on its status, which /doors carries as
// `targetStatus`. This module turns that payload into one reason per door, the count line, the
// pop-up line, and the dead-end warnings the panel shows BEFORE the admin cuts into nothing.

// The preview payload, indexed once per response (memo this on the page): the kept set, and one
// id → reason map over the server's buckets, which are disjoint by construction (Exclude doors
// acts in the resolver before the boxes; the boxes in the order the page lists them).
export const indexPreview = (preview) => {
  if (!preview?.householdIds) return null;
  const reason = new Map();
  const leftOut = preview.leftOut || {};
  for (const id of preview.excludedHouseholdIds || []) reason.set(String(id), 'excluded');
  for (const key of ['restricted', 'noSoliciting', 'unplaced', 'other']) {
    for (const id of leftOut[key] || []) reason.set(String(id), key);
  }
  return { kept: new Set((preview.householdIds || []).map(String)), reason };
};

// null = in the cut (bright). A drawn door in no bucket and not kept failed the ticks themselves.
export const fadeReasonOf = (doorId, index) => {
  if (!index) return null;
  const id = String(doorId);
  if (index.kept.has(id)) return null;
  return index.reason.get(id) || 'status';
};

// What "failed the ticks" means depends on what was ticked: statuses, survey answers, or both
// (OR = matches neither; AND = doesn't match both). `mode` is { statusesOn, answersOn, combine }.
// Returns the whole predicate, so the count line reads "N <predicate>".
const failedTicks = (mode = {}) => {
  const { statusesOn, answersOn, combine } = mode;
  if (statusesOn && answersOn) return combine === 'and' ? "don't match both the ticked statuses and the answers" : 'match neither the ticked statuses nor the answers';
  if (answersOn) return 'have no matching answer';
  return "don't match the ticked statuses";
};

// The pop-up's line. `targetStatus` is the door's all-rounds status (the one a tick reads).
export const fadeReasonLine = (reason, { targetStatus, mode } = {}) => {
  switch (reason) {
    case null:
      return 'In this cut.';
    case 'status': {
      const label = STATUS_LABELS[targetStatus] || 'Unknocked';
      if (mode?.answersOn && !mode?.statusesOn) return 'Faded: no matching survey answer.';
      if (mode?.answersOn) {
        return mode.combine === 'and'
          ? `Faded: reads ${label} across all rounds, and doesn't match both the statuses and the answers.`
          : `Faded: reads ${label} across all rounds, and no matching survey answer.`;
      }
      return `Faded: reads ${label} across all rounds, which isn't ticked.`;
    }
    case 'excluded':
      return 'Faded: removed by Exclude doors.';
    case 'restricted':
      return 'Faded: left out by "Exclude restricted-access homes".';
    case 'noSoliciting':
      return 'Faded: left out by "Exclude no-soliciting homes".';
    case 'unplaced':
      return 'Faded: left out by "Leave out homes without a reliable map spot".';
    default:
      return 'Faded: left out of this cut.';
  }
};

// The same reasons in a few words, for a building pop-up's per-unit line.
export const fadeReasonShort = (reason, { mode } = {}) => {
  if (reason === 'status') {
    if (mode?.answersOn && !mode?.statusesOn) return 'no matching answer';
    if (mode?.answersOn) return mode.combine === 'and' ? "doesn't match both" : 'matches neither';
    return "status isn't ticked";
  }
  return (
    {
      excluded: 'removed by Exclude doors',
      restricted: 'left out by the restricted-access box',
      noSoliciting: 'left out by the no-soliciting box',
      unplaced: 'left out by the map-spot box',
      other: 'left out of this cut',
    }[reason] || 'in this cut'
  );
};

// The count line under Target doors: "N targeted doors · M removed by Exclude doors · …", only the
// parts that are non-zero, from the preview's own `counts` — the server counts over everything the
// map CAN draw, because the drawn set shrinks the moment loose doors are hidden (after a cut, by
// default) and the doors the boxes dropped are exactly the loose ones.
export const targetCountParts = (counts = {}, mode = {}) => {
  const n = (v) => (Number(v) || 0).toLocaleString();
  const parts = [`${n(counts.kept)} targeted door${counts.kept === 1 ? '' : 's'}`];
  if (counts.excluded) parts.push(`${n(counts.excluded)} removed by Exclude doors`);
  if (counts.restricted) parts.push(`${n(counts.restricted)} restricted left out`);
  if (counts.noSoliciting) parts.push(`${n(counts.noSoliciting)} no-soliciting left out`);
  if (counts.unplaced) parts.push(`${n(counts.unplaced)} without a reliable map spot left out`);
  if (counts.other) parts.push(`${n(counts.other)} left out`);
  if (counts.status) parts.push(`${n(counts.status)} ${failedTicks(mode)}`);
  return parts;
};

// Status census over the drawn doors by all-rounds status — the legend while Target doors is
// open (CoverageBar's `canvass` shape).
export const targetCensus = (drawnDoors) => {
  const counts = {};
  for (const d of drawnDoors || []) {
    const s = d.targetStatus || 'unknocked';
    counts[s] = (counts[s] || 0) + 1;
  }
  return counts;
};

// What a tick means, in one line (the panel's hint). Mirrors utils/statusPrecedence.js
// resolveTargetingStatus — change one, change both.
export const TARGET_RULE_HINT =
  'Statuses read every round: Restricted wins over everything, even a later survey or knock, until the mark is unmarked or unknocked; ' +
  'Surveyed is surveyed in any round; Not home is nobody ever answered; Unknocked is never visited. ' +
  'A later not-home never undoes an answer (refused, wrong address, no soliciting, not a target voter).';

// Combinations that can only cut nothing, said before the cut instead of after. `boxes` are the
// checkboxes as SENT (ticked and with something to remove).
export const targetDeadEnds = ({ statuses = [], answersOn = false, combine = 'or', boxes = {} } = {}) => {
  const notes = [];
  if (statuses.includes('restricted') && boxes.excludeRestricted) {
    notes.push('Restricted is ticked, but "Exclude restricted-access homes" is on, so those doors stay out — untick that box to cut them.');
  }
  if (statuses.includes('no_soliciting') && boxes.excludeNoSoliciting) {
    notes.push('No soliciting is ticked, but "Exclude no-soliciting homes" is on, so those doors stay out — untick that box to cut them.');
  }
  // The ticked statuses are ONE set (OR within it) in the resolver, so AND with an answer is a
  // dead end only when none of them can carry an answer: a door with a survey answer reads Surveyed,
  // or Restricted when it also carries a mark (restricted outranks everything).
  const CAN_CARRY_AN_ANSWER = ['surveyed', 'lit_dropped', 'restricted'];
  if (answersOn && combine === 'and' && statuses.length > 0 && statuses.every((s) => !CAN_CARRY_AN_ANSWER.includes(s))) {
    notes.push('A door with a survey answer reads Surveyed (or Restricted, if it also carries a mark), so AND between these statuses and an answer matches nothing — use OR, or tick Surveyed too.');
  }
  return notes;
};
