import mongoose from 'mongoose';
import { FbTimePersonLink } from '../../models/FbTimePersonLink.js';
import { FbTimeConnection } from '../../models/FbTimeConnection.js';
import { FbTimeShift } from '../../models/FbTimeShift.js';
import { IntegrationEvent } from '../../models/IntegrationEvent.js';
import { loadShiftOwners } from './shiftOwner.js';

// THE FBTIME STEP OF THE 180-DAY IDENTITY PURGE — de-pairing, never reverting.
//
// Until the purge, a deleted account's FbTime link and kept entries are what keep its
// measured hours its own (decision 11) and let an admin answer "was the link right?". Once
// the purge runs, nothing on Doorline's side may tie that account to an FbTime person any
// more (decision 10). Reverting the account's shifts to "unmapped" was tried in review and
// flipped every campaign rate over their days to estimated (reproduced) — so the shifts keep
// their userId and lose the PERSON instead.
//
// Keyed on the ACCOUNT, across every org and every connection status: a disconnected or
// errored connection, and an org the person had already left, keep links and events too
// (DeletedUserRecord.organizationIds lists only the memberships active at deletion).
//
// Holds while DELETED_IDENTITY_RETENTION_DAYS ≥ 121 (default 180): a shift clocked before
// the deletion is then older than the hours sync's 120-day deep window, so no later pull
// re-pairs it with its person.
//
// Called per record by services/retention/purgeDeletedIdentities.js (before the record's
// purgedAt stamp) and by the one-off migrate:fbtime-deletion-gaps for records already purged.

// A shift that no longer names its FbTime person. A later link of that person claims none
// of these (every reassign queries by person id).
export const PURGED_PERSON = 'purged';

const LINK_EVENT_TYPES = ['link-created', 'link-removed', 'account-kept', 'account-kept-removed'];

/**
 * De-pair one deleted account from FbTime everywhere. `apply: false` counts only.
 * → { links, kept, rejected, clears, shiftsKept, shiftsReassigned, events, orgs }
 */
export const depairFbtimeAccount = async ({ userId, deletedAt, apply = true }) => {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const idStr = String(uid);
  const cut = new Date(deletedAt);
  if (Number.isNaN(cut.getTime())) throw new Error('depairFbtimeAccount needs the account deletedAt');

  const [links, conns, shiftOrgs] = await Promise.all([
    FbTimePersonLink.find({ userId: uid }).select('organizationId').lean(),
    FbTimeConnection.find({
      $or: [
        { 'keptAccounts.userId': uid },
        { 'doors.rejected.userId': uid },
        { 'doors.clearPersons.fromUserId': uid },
      ],
    })
      .select('organizationId keptAccounts doors.rejected doors.clearPersons')
      .lean(),
    // Scoped to orgs that have a connection row, so { organizationId, userId, clockIn }
    // serves the shift queries (a { userId }-only query is a collection scan).
    FbTimeConnection.distinct('organizationId'),
  ]);

  const mine = (id) => String(id) === idStr;
  const counts = { links: links.length, kept: 0, rejected: 0, clears: 0, shiftsKept: 0, shiftsReassigned: 0, events: 0, orgs: 0 };
  for (const c of conns) {
    counts.kept += (c.keptAccounts || []).filter((k) => mine(k.userId)).length;
    counts.rejected += (c.doors?.rejected || []).filter((r) => mine(r.userId)).length;
    counts.clears += (c.doors?.clearPersons || []).filter((p) => mine(p.fromUserId)).length;
  }

  const shiftScope = { organizationId: { $in: shiftOrgs }, userId: uid };
  const beforeDeletion = { ...shiftScope, clockIn: { $lt: cut }, fbtimePersonId: { $ne: PURGED_PERSON } };
  const fromDeletion = { ...shiftScope, clockIn: { $gte: cut } };
  const eventFilter = {
    type: { $in: LINK_EVENT_TYPES },
    $and: [
      // detail.userId is stored as a string, sometimes upper-case.
      { $or: [{ 'detail.userId': { $in: [idStr, uid] } }, { 'detail.userId': new RegExp(`^${idStr}$`, 'i') }] },
      { $or: [{ 'detail.fbtimePersonId': { $exists: true } }, { 'detail.userEmail': { $exists: true } }] },
    ],
  };

  const [shiftsKept, laterShifts, events] = await Promise.all([
    FbTimeShift.countDocuments(beforeDeletion),
    FbTimeShift.find(fromDeletion).select('_id organizationId fbtimePersonId clockIn userId').lean(),
    IntegrationEvent.countDocuments(eventFilter),
  ]);
  counts.shiftsKept = shiftsKept;
  counts.shiftsReassigned = laterShifts.length;
  counts.events = events;

  const touched = new Map(); // org → links removed there
  for (const l of links) touched.set(String(l.organizationId), (touched.get(String(l.organizationId)) || 0) + 1);
  for (const c of conns) if (!touched.has(String(c.organizationId))) touched.set(String(c.organizationId), 0);
  counts.orgs = touched.size;
  if (!apply) return counts;

  // 1. The links.
  await FbTimePersonLink.deleteMany({ userId: uid });

  // 2. Three separate updates — combined, an arrayFilters write throws on rows without the
  //    array. A waiting clear stays (it is the admin's request about the FbTime PERSON);
  //    only the account goes from it.
  await FbTimeConnection.updateMany({ 'keptAccounts.userId': uid }, { $pull: { keptAccounts: { userId: uid } } });
  await FbTimeConnection.updateMany({ 'doors.rejected.userId': uid }, { $pull: { 'doors.rejected': { userId: uid } } });
  await FbTimeConnection.updateMany(
    { 'doors.clearPersons.fromUserId': uid },
    { $set: { 'doors.clearPersons.$[c].fromUserId': null } },
    { arrayFilters: [{ 'c.fromUserId': uid }] }
  );

  // 3. Its shifts. Clocked before the deletion: they stay the account's (its hours stay
  //    measured) and lose the person. At or after: whoever owns them now, without it.
  await FbTimeShift.updateMany(beforeDeletion, { $set: { fbtimePersonId: PURGED_PERSON } });
  const byOrg = new Map();
  for (const s of laterShifts) {
    const org = String(s.organizationId);
    if (!byOrg.has(org)) byOrg.set(org, []);
    byOrg.get(org).push(s);
  }
  for (const [org, shifts] of byOrg) {
    const ownerOf = await loadShiftOwners(org, { without: uid });
    const byTarget = new Map();
    for (const s of shifts) {
      const target = ownerOf(s.fbtimePersonId, s.clockIn);
      const key = target ? String(target) : 'null';
      if (!byTarget.has(key)) byTarget.set(key, []);
      byTarget.get(key).push(s._id);
    }
    for (const [key, ids] of byTarget) {
      await FbTimeShift.updateMany(
        { _id: { $in: ids } },
        { $set: { userId: key === 'null' ? null : new mongoose.Types.ObjectId(key) } }
      );
    }
  }

  // 4. The link-type events keep what happened, not with whom: no person id beside the account.
  await IntegrationEvent.updateMany(eventFilter, { $unset: { 'detail.fbtimePersonId': '', 'detail.userEmail': '' } });

  // 5. One row per org touched, with no ids — the org's history says links went, and why.
  for (const [organizationId, count] of touched) {
    await IntegrationEvent.create({
      organizationId,
      byUserId: null,
      type: 'link-removed',
      detail: { reason: 'identity-purge', count },
    });
  }
  return counts;
};
