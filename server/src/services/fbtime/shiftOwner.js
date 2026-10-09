import mongoose from 'mongoose';
import { FbTimeShift } from '../../models/FbTimeShift.js';
import { FbTimePersonLink } from '../../models/FbTimePersonLink.js';
import { FbTimeConnection } from '../../models/FbTimeConnection.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { KNOCK_ACTIONS, NOT_BULK } from '../reports/aggregations.js';
import { zonedDayRange, zonedDayStr } from '../../utils/timezone.js';

// WHOSE HOURS IS THIS SHIFT? One rule, used by every writer of FbTimeShift.userId —
// the unlink route, the link and auto-match backfills, the hours sync, Stop counting,
// and the 180-day identity purge. Four copies of "the person's current link" used to
// live in those places; they had to become one the moment kept accounts existed.
//
// A kept account (FbTimeConnection.keptAccounts) is an admin's "the link was right"
// on unlink: one FbTime person is one human, across more than one Doorline account
// (they deleted theirs and came back with a new one). Shifts clocked before the kept
// entry's `until` stay with that earlier account, so last season's measured rates stay
// measured (owner ruling, 2026-10-08). With no kept entry this is exactly the old rule:
// the person's current link, or nobody.
//
// The rule: the kept entry for that person with the smallest `until` LATER than the
// shift's clockIn owns it; otherwise the current link; otherwise nobody (null).

export const normPersonId = (id) => {
  const s = String(id ?? '').trim().toLowerCase();
  return /^[0-9a-f]{24}$/.test(s) ? s : null;
};

/** Pure: the owner of one shift, given that person's kept entries and current link. */
export const shiftOwnerOf = (keptForPerson, linkUserId, clockIn) => {
  const at = clockIn instanceof Date ? clockIn : new Date(clockIn);
  let best = null;
  for (const k of keptForPerson || []) {
    if (!k?.until || !(at < new Date(k.until))) continue;
    if (!best || new Date(k.until) < new Date(best.until)) best = k;
  }
  if (best) return best.userId ?? null;
  return linkUserId ?? null;
};

/**
 * Load one organization's owners once: (fbtimePersonId, clockIn) → userId | null.
 * `without` leaves an account out entirely (the purge resolves "the current link, or
 * nobody" for a purged account's later shifts).
 */
export const loadShiftOwners = async (organizationId, { without = null } = {}) => {
  const skip = without ? String(without) : null;
  const [links, conn] = await Promise.all([
    FbTimePersonLink.find({ organizationId }).select('userId fbtimePersonId').lean(),
    FbTimeConnection.findOne({ organizationId }).select('keptAccounts').lean(),
  ]);
  const linkByPerson = new Map();
  for (const l of links) {
    const pid = normPersonId(l.fbtimePersonId);
    if (!pid || String(l.userId) === skip) continue;
    if (!linkByPerson.has(pid)) linkByPerson.set(pid, l.userId);
  }
  const keptByPerson = new Map();
  for (const k of conn?.keptAccounts || []) {
    const pid = normPersonId(k.fbtimePersonId);
    if (!pid || String(k.userId) === skip) continue;
    if (!keptByPerson.has(pid)) keptByPerson.set(pid, []);
    keptByPerson.get(pid).push(k);
  }
  return (personId, clockIn) => {
    const pid = normPersonId(personId);
    if (!pid) return null;
    return shiftOwnerOf(keptByPerson.get(pid), linkByPerson.get(pid), clockIn);
  };
};

/**
 * THE CUT AT LINK TIME. When an FbTime person is linked to a (new) Doorline account, each
 * kept earlier account of that person keeps only what came before the new account began:
 *   cut = max(start of the local day of the new account's first door result in the org,
 *             the kept account's last door result + 1 ms)
 * and `until` moves earlier to the cut when the cut is earlier. Admins link the new account
 * after it has already worked, so the kept account's `until` (its deletion, or the unlink)
 * would otherwise hand the new account's first shifts to the old one and turn the current
 * campaign's rate "estimated" (round 4, reproduced). The floor keeps every one of the kept
 * account's own door results before the cut, so the count and the shift owner always share
 * one `until`. A "door result" is the count's match: KNOCK_ACTIONS + restricted, NOT_BULK.
 * Returns the number of kept entries moved.
 */
export const cutKeptAccounts = async (organizationId, fbtimePersonId, newUserId) => {
  const pid = normPersonId(fbtimePersonId);
  if (!pid || !newUserId) return 0;
  const conn = await FbTimeConnection.findOne({ organizationId }).select('keptAccounts').lean();
  const kept = (conn?.keptAccounts || []).filter((k) => normPersonId(k.fbtimePersonId) === pid);
  if (!kept.length) return 0;

  const doorMatch = (userId) => ({
    organizationId,
    userId,
    actionType: { $in: [...KNOCK_ACTIONS, 'restricted'] },
    ...NOT_BULK,
  });

  const first = await CanvassActivity.findOne(doorMatch(newUserId)).sort({ timestamp: 1 }).select('timestamp campaignId').lean();
  if (!first) return 0; // the new account hasn't worked yet — nothing to protect
  const campaign = await Campaign.findById(first.campaignId).select('timeZone').lean();
  const org = await Organization.findById(organizationId).select('timeZone').lean();
  const tz = campaign?.timeZone || org?.timeZone || 'America/New_York';
  const day = zonedDayStr(first.timestamp, tz);
  const dayStart = zonedDayRange(day, day, tz).$gte;

  let moved = 0;
  for (const k of kept) {
    const last = await CanvassActivity.findOne(doorMatch(k.userId)).sort({ timestamp: -1 }).select('timestamp').lean();
    const floor = last ? new Date(new Date(last.timestamp).getTime() + 1) : null;
    const cut = floor && floor > dayStart ? floor : dayStart;
    if (!k.until || cut < new Date(k.until)) {
      const res = await FbTimeConnection.updateOne(
        { organizationId, keptAccounts: { $elemMatch: { fbtimePersonId: k.fbtimePersonId, userId: k.userId } } },
        { $set: { 'keptAccounts.$[k].until': cut } },
        { arrayFilters: [{ 'k.fbtimePersonId': k.fbtimePersonId, 'k.userId': k.userId }] }
      );
      moved += res.modifiedCount || 0;
    }
  }
  return moved;
};

/**
 * Re-assign ALL of one person's cached shifts (no window) through the owner rule.
 * Writes only rows whose owner actually changes, grouped into one updateMany per
 * target. Returns the number of shifts moved.
 */
export const reassignPersonShifts = async (organizationId, fbtimePersonId, { owner } = {}) => {
  const pid = normPersonId(fbtimePersonId);
  if (!pid) return 0;
  const ownerOf = owner || (await loadShiftOwners(organizationId));
  const shifts = await FbTimeShift.find({ organizationId, fbtimePersonId: pid })
    .select('_id clockIn userId')
    .lean();
  const byTarget = new Map();
  for (const s of shifts) {
    const target = ownerOf(pid, s.clockIn);
    const key = target ? String(target) : 'null';
    if (String(s.userId ?? 'null') === key) continue;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(s._id);
  }
  let moved = 0;
  for (const [key, ids] of byTarget) {
    const res = await FbTimeShift.updateMany(
      { _id: { $in: ids } },
      { $set: { userId: key === 'null' ? null : new mongoose.Types.ObjectId(key) } }
    );
    moved += res.modifiedCount || 0;
  }
  return moved;
};
