// Turf Cutting's view-only page (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §D.3): which pass is view-only,
// what its banner says and offers, the short reason a read-only panel prints, and "Undo last discard"
// belonging to the pass it was made on. Pure (walkListOptions.js is pure too), so node --test holds
// every sentence. (A stale page — a write refused because someone archived the pass elsewhere — is
// refreshed by the shared refreshAfterRefusal in components/walkListLifecycle, as on Walk Lists.)
//
// `pass` is a GET /passes row (archivedAt, archivedVia, archivedFrom, archivedByName, endedByPassName,
// bringBack, bringBackMessage), `effort` its GET /efforts row, `campaign` the campaign list row.

import { isArchivedWalkList, passShortLabel } from './walkListOptions.js';

// ── Why the page is view-only ──
// The campaign first (nothing on it can change), then the walk list (every pass of it is frozen,
// drafts included), then the pass itself. null = the page is editable.
export const viewOnlyReason = ({ pass, effort, campaign } = {}) => {
  if (campaign?.isActive === false) return 'campaign';
  if (isArchivedWalkList(effort)) return 'walk-list';
  if (pass?.status === 'archived') return 'pass';
  return null;
};

// A pass that can never come back, whatever anyone unarchives: it ended because the next pass went
// live (stamped, or inferred for a pass archived before the stamp existed), or the server's verdict
// names a permanent reason.
const PERMANENT_REFUSALS = new Set(['ended-by-next-pass', 'later-pass-went-live', 'unknown-end', 'walk-list-missing']);
const endedByNextPass = (pass) => pass?.archivedVia === 'next-pass' || (!pass?.archivedVia && !!pass?.endedByPassName);
const cannotComeBack = (pass) =>
  endedByNextPass(pass) || (pass?.bringBack?.ok === false && PERMANENT_REFUSALS.has(pass.bringBack.reason));

// "It ended Oct 12, when Pass 3 went live." — how an archived pass ended. `day` formats a date
// ("Oct 12"); a missing date just drops out of the sentence.
export const endedSentence = (pass, effort, day = (d) => d) => {
  const date = pass?.archivedAt ? day(pass.archivedAt) : null;
  const on = date ? ` ${date}` : '';
  const by = pass?.archivedByName || null;
  if (pass?.archivedFrom === 'draft') {
    return `It was a draft when ${by ? `${by} archived it` : 'it was archived'}${date ? ` on ${date}` : ''}.`;
  }
  switch (pass?.archivedVia) {
    case 'next-pass':
      return `It ended${on}, when ${pass.endedByPassName || 'the next pass'} went live.`;
    case 'walk-list':
      return `It ended${on}, when ${effort?.name || 'its walk list'} was archived.`;
    case 'pass':
      return by ? `It ended${on}, when ${by} archived it.` : `It ended${on}, archived by hand.`;
    case 'repair':
      return `The one-time check ended it${date ? ` on ${date}` : ''}.`;
    default:
      // Archived before archivedVia existed: "when Pass N went live" is inferred server-side.
      return pass?.endedByPassName ? `It ended${on}, when ${pass.endedByPassName} went live.` : `It ended${on}.`;
  }
};

// The walk list's live pass, other than this one — what "Open Pass N" switches to.
const liveSibling = (pass, passes) =>
  (passes || []).find(
    (p) => p.status === 'active' && String(p.effortId) === String(pass?.effortId) && String(p._id) !== String(pass?._id)
  ) || null;

const AS_THEY_WERE = "You're looking at its books as they were.";

// The one banner at the top of a view-only page: { text, action } — action is
// { kind: 'unarchive' | 'bring-back' | 'open', label, passId? } or null — or null when the page is
// editable. Never says "nothing here can change": deleting a snapshot still works, by design.
export const viewOnlyNotice = ({ pass, effort, campaign, passes = [], day = (d) => d } = {}) => {
  const reason = viewOnlyReason({ pass, effort, campaign });
  if (!reason) return null;
  const P = pass ? passShortLabel(pass) : 'This pass';
  const W = effort?.name || 'This walk list';

  if (reason === 'campaign') {
    return {
      text: pass
        ? `This campaign is archived, so ${P} is view-only. ${AS_THEY_WERE} An org admin can reactivate the campaign from Campaigns.`
        : 'This campaign is archived, so its passes are view-only. An org admin can reactivate it from Campaigns.',
      action: null,
    };
  }

  if (reason === 'walk-list') {
    const unarchive = { kind: 'unarchive', label: `Unarchive ${W}` };
    if (pass?.status === 'archived') {
      const also = pass.archivedVia === 'walk-list' ? '' : ` ${W} is archived too.`;
      return { text: `${P} is archived. ${endedSentence(pass, effort, day)}${also} ${AS_THEY_WERE}`, action: unarchive };
    }
    if (pass?.status === 'active') {
      // Archived before this change with its pass still live — until the one-time repair ends it.
      return {
        text: `${W} is archived, but ${P} is still live. You're looking at its books as they are; unarchive ${W} to change them.`,
        action: unarchive,
      };
    }
    return { text: `${W} is archived, so ${P} stays a draft and can't be cut or started. ${AS_THEY_WERE}`, action: unarchive };
  }

  // The pass is archived and its walk list is open.
  const verdict = pass.bringBack || null;
  // Why it can't come back, when the server says — except the one the ended sentence already gives.
  const why = verdict && !verdict.ok && verdict.reason !== 'ended-by-next-pass' && pass.bringBackMessage ? ` ${pass.bringBackMessage}` : '';
  const live = liveSibling(pass, passes);
  const action = verdict?.ok
    ? { kind: 'bring-back', label: `Bring back ${P}` }
    : live
    ? { kind: 'open', label: `Open ${passShortLabel(live)}`, passId: String(live._id) }
    : null;
  return { text: `${P} is archived. ${endedSentence(pass, effort, day)} ${AS_THEY_WERE}${why}`, action };
};

// The short reason a read-only control prints (the door selection bar, the book panel).
export const viewOnlyLine = ({ pass, effort, campaign } = {}) => {
  const reason = viewOnlyReason({ pass, effort, campaign });
  if (reason === 'campaign') return 'This campaign is archived — view only.';
  if (reason === 'walk-list') return `${effort?.name || 'This walk list'} is archived — view only.`;
  if (reason === 'pass') return `${passShortLabel(pass)} is archived — view only.`;
  return null;
};

// Under the snapshot list, where Restore is gone: what it takes to restore one.
export const snapshotRestoreNote = ({ pass, effort, campaign } = {}) => {
  const reason = viewOnlyReason({ pass, effort, campaign });
  if (reason === 'campaign') return 'Reactivate the campaign to restore a snapshot.';
  if (reason === 'walk-list') {
    if (pass?.status !== 'archived') return `Unarchive ${effort?.name || 'the walk list'} to restore a snapshot.`;
    if (endedByNextPass(pass)) return "This pass can't come back, so its snapshots can't be restored.";
    return `Unarchive ${effort?.name || 'the walk list'} and bring the pass back to restore a snapshot.`;
  }
  if (reason === 'pass') {
    return cannotComeBack(pass)
      ? "This pass can't come back, so its snapshots can't be restored."
      : 'Bring the pass back to restore a snapshot.';
  }
  return null;
};

// The Canvassers stat's hint. On a view-only page it states what happened rather than what to do.
export const crewHint = ({ unassignedBooks = 0, publishedCount = 0, viewOnly = false } = {}) => {
  const books = `${unassignedBooks} book${unassignedBooks === 1 ? '' : 's'}`;
  if (!viewOnly) return unassignedBooks > 0 ? `${books} unassigned` : 'every book covered';
  if (unassignedBooks > 0) return `${books} had no canvasser`;
  return publishedCount > 0 ? 'every book had a canvasser' : undefined;
};

// ── "Undo last discard" ──
// A discard's snapshot belongs to the pass it was made on. The page remembers { passId, snapshotId }
// and offers the undo only on that pass — before this, switching passes left the button pointing at
// the other pass's snapshot.
export const undoDiscardSnapshotId = (lastSnapshot, passId) =>
  lastSnapshot?.snapshotId && passId && String(lastSnapshot.passId) === String(passId) ? lastSnapshot.snapshotId : null;
