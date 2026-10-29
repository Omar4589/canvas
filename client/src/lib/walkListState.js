// One plain-English status per walk list — never "archived" and "Live" on the same row
// (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §D.1). Pure: it reads the fields GET /efforts sends (status,
// activeRound, archivedAt, archivedByName, endedPassId, lastEndedPass, everLive, setup), plus the
// campaign's passes when the caller has them (only to name a waiting draft), and the caller formats
// dates in the campaign's zone (`formatDate`). First match wins:
//
//   1. Archived · Pass 3 still live        archived from before this change, until the one-time check
//   2. Archived Oct 27 by Ada · Pass 3 ended               its archive ended that pass
//   3. Archived · Pass 3 ended by the one-time check
//   4. Archived Oct 27 by Ada                              nothing was live
//   5. Archived                                            archived before this change: no date, no name
//   6. Live · Pass 3
//   7. Between passes · Pass 1 ended Oct 20 · Pass 2 draft  a pass has been live, none is now
//   8. Setting up · 4/5 · next: Pass activated              no pass has ever been live
//   9. No passes yet

const isoDay = (iso) => (iso ? String(iso).slice(0, 10) : '');
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const passN = (pass) => (pass?.roundNumber == null ? 'Pass' : `Pass ${pass.roundNumber}`);
const joinParts = (...parts) => parts.filter(Boolean).join(' · ');

// "Oct 27 by Ada", "Oct 27", "by Ada" or '' — whatever was recorded.
const whenBy = (at, name, formatDate) => [at ? formatDate(at) : '', name ? `by ${name}` : ''].filter(Boolean).join(' ');

const state = (key, tone, label, detail = '') => ({ key, tone, label, detail });

// Its drafts, lowest number first: "Pass 2 draft", or "3 drafts".
const draftsPart = (effort, passes) => {
  const drafts = (passes || [])
    .filter((p) => p.status === 'draft' && sameId(p.effortId, effort._id))
    .sort((a, b) => (a.roundNumber ?? 0) - (b.roundNumber ?? 0));
  if (!drafts.length) return '';
  return drafts.length === 1 ? `${passN(drafts[0])} draft` : `${drafts.length} drafts`;
};

// Does it have any pass at all? Setup's "Pass created" step says so; a list of passes or an ended
// pass are proof too.
const hasPasses = (effort, passes) => {
  if (effort.lastEndedPass || effort.activeRound) return true;
  if ((passes || []).some((p) => sameId(p.effortId, effort._id))) return true;
  return (effort.setup?.steps || []).some((s) => s.key === 'round' && s.status === 'done');
};

// tone is a Badge variant: success = live, warning = the amber pre-repair state, info = setting up.
export const walkListState = (effort, { formatDate = isoDay, passes = null } = {}) => {
  const e = effort || {};
  const live = e.activeRound || null;
  const ended = e.lastEndedPass || null;

  if (e.status === 'archived') {
    if (live) return state('archived-still-live', 'warning', 'Archived', `${passN(live)} still live`);
    const stamp = whenBy(e.archivedAt, e.archivedByName, formatDate);
    // The pass THIS archive ended. A walk list unarchived ("Unarchive only") and archived again keeps
    // its old ended pass as lastEndedPass, but endedPassId is cleared, so it doesn't claim this one.
    const endedHere = ended && sameId(e.endedPassId, ended._id) ? ended : null;
    if (endedHere?.archivedVia === 'walk-list') return state('archived-ended', 'neutral', 'Archived', joinParts(stamp, `${passN(endedHere)} ended`));
    if (endedHere?.archivedVia === 'repair') {
      return state('archived-repair', 'neutral', 'Archived', joinParts(stamp, `${passN(endedHere)} ended by the one-time check`));
    }
    if (stamp) return state('archived-by', 'neutral', 'Archived', stamp);
    return state('archived', 'neutral', 'Archived');
  }

  if (live) return state('live', 'success', 'Live', passN(live));
  // everLive is new on GET /efforts; without it, an ended pass is the best sign one went live.
  const everLive = e.everLive ?? !!ended;
  if (everLive) {
    return state(
      'between-passes',
      'neutral',
      'Between passes',
      joinParts(ended ? `${passN(ended)} ended${ended.archivedAt ? ` ${formatDate(ended.archivedAt)}` : ''}` : '', draftsPart(e, passes))
    );
  }
  if (hasPasses(e, passes)) {
    const s = e.setup;
    const detail = s
      ? joinParts(s.stepsTotal ? `${s.stepsDone || 0}/${s.stepsTotal}` : '', s.nextStepLabel ? `next: ${s.nextStepLabel}` : '')
      : '';
    return state('setting-up', 'info', 'Setting up', detail);
  }
  return state('no-passes', 'neutral', 'No passes yet');
};

export const isArchivedState = (s) => String(s?.key || '').startsWith('archived');

// What a Walk Lists row offers (§D.1). Open: Manage · Archive · Delete. Archived: View · Unarchive ·
// Delete, plus End Pass N while a pass is still live. Delete only when every pass is still a draft
// (canDelete; the server still checks the doors' history). An archived CAMPAIGN turns every change off.
export const walkListActions = (effort, { campaignArchived = false } = {}) => {
  const e = effort || {};
  const archived = e.status === 'archived';
  const writable = !campaignArchived;
  return {
    open: archived || campaignArchived ? 'View' : 'Manage',
    archive: writable && !archived,
    unarchive: writable && archived,
    endPass: writable && archived && e.activeRound ? `End ${passN(e.activeRound)}` : null,
    remove: writable && !!e.canDelete,
  };
};

// ── Archived passes (the Passes panel, §D.2) ──

// How an archived pass ended. Rows from before this change carry no archivedVia; the server infers
// the pass that ended them (endedByPassName) from the shared timestamp when it can.
export const passEndedHow = (pass, effortName) => {
  switch (pass?.archivedVia) {
    case 'pass':
      return 'by hand';
    case 'walk-list':
      return `when ${effortName || 'its walk list'} was archived`;
    case 'next-pass':
      return `when ${pass.endedByPassName || 'the next pass'} went live`;
    case 'repair':
      return 'by the one-time check';
    default:
      return pass?.endedByPassName ? `when ${pass.endedByPassName} went live` : '';
  }
};

// "Oct 27 by Ada · by hand" — shown after the row's Archived badge.
export const archivedPassDetail = (pass, { formatDate = isoDay, effortName } = {}) =>
  joinParts(whenBy(pass?.archivedAt, pass?.archivedByName, formatDate), passEndedHow(pass, effortName));
