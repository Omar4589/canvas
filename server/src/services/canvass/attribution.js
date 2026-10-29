import mongoose from 'mongoose';
import { Turf } from '../../models/Turf.js';
import { Pass } from '../../models/Pass.js';
import { activePassIds } from '../passes/activePasses.js';

// Which pass (round) and book a door action counts in — decided at save time, from the door
// (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §B.7). Efforts are door-disjoint, so a household is in at most
// one active round's books — no time-window guessing for a knock made on a live pass. effortId is
// always the door's owner.
//
// Step 1 — the book the PHONE says it was in (an updated phone sends the door's `turfId` from its
// cached bootstrap, at tap time). A late knock — an offline replay, a phone that sat in a dead zone —
// then counts in the pass it was made in, even after that pass ended:
//   - the book must still exist, be published, still hold the door, and belong to the door's
//     walk list (a discarded or re-cut pass's books are gone, a merged-away or split-away door is no
//     longer in that book — those fall to step 2);
//   - a LIVE pass's book is used as is;
//   - an ARCHIVED pass's book only when the knock was made before the next pass started: while that
//     pass was live (tap time no later than its archivedAt), or after it ended but before the live
//     book's pass first went live, or when no live book holds the door. A canvasser working
//     yesterday's book after the next pass started counts in the new pass when it holds the door,
//     so its crew sees the door done (owner ruling 9).
// Step 2 — today's rule: the live book that holds the door, else no pass ("Legacy / no pass").
//
// A phone without the update sends no turfId and gets step 2 exactly. An invalid turfId is IGNORED,
// never refused: the offline queue deletes an item on any 4xx (mobile/lib/offlineQueue.js), so a
// refusal would lose a real knock — and only a string is tried, because a number or an object
// casts to a 500 that would stall the phone's queue. The switch: LATE_KNOCK_ATTRIBUTION=off turns
// step 1 off (any spelling of "off"; anything else, unset included, means on). There is deliberately
// NO server-side fallback for phones without the update (an earlier design filed late knocks into
// "the walk list's most recently archived pass" — it put a discarded pass's knocks into the previous
// pass, where the replace deleted that pass's real answers).

export const lateKnockAttributionOn = () =>
  String(process.env.LATE_KNOCK_ATTRIBUTION || '').trim().toLowerCase() !== 'off';

export const usableClientTurfId = (v) => typeof v === 'string' && mongoose.isObjectIdOrHexString(v);

export const resolveAttribution = async (campaign, household, { clientTurfId = null, tappedAt = null } = {}) => {
  const effortId = household.effortId || null;
  const passIds = await activePassIds(campaign._id);
  const liveBook = passIds.length
    ? await Turf.findOne(
        { campaignId: campaign._id, passId: { $in: passIds }, status: 'published', householdIds: household._id },
        { _id: 1, passId: 1 }
      ).lean()
    : null;
  const today = { passId: liveBook?.passId || null, turfId: liveBook?._id || null, effortId };

  if (!lateKnockAttributionOn() || !usableClientTurfId(clientTurfId) || !effortId) return today;
  // The common case: the phone's book IS the live book.
  if (liveBook && String(liveBook._id) === String(clientTurfId)) return today;

  const book = await Turf.findOne(
    { _id: clientTurfId, campaignId: campaign._id, status: 'published', householdIds: household._id },
    { _id: 1, passId: 1 }
  ).lean();
  if (!book) return today;
  const pass = await Pass.findOne({ _id: book.passId, campaignId: campaign._id, effortId }, { status: 1, archivedAt: 1 }).lean();
  if (pass?.status === 'active') return { passId: book.passId, turfId: book._id, effortId };
  if (pass?.status === 'archived' && pass.archivedAt) {
    const tap = tappedAt instanceof Date && !Number.isNaN(tappedAt.getTime()) ? tappedAt : new Date();
    const madeWhileLive = tap.getTime() <= new Date(pass.archivedAt).getTime();
    if (madeWhileLive || !liveBook) return { passId: book.passId, turfId: book._id, effortId };
    // Made in the gap between this pass ending and the next one starting: no newer pass existed yet.
    // Without this a knock delivered before the next pass started (the branch above) and retried after
    // would count in both passes.
    const next = await Pass.findOne({ _id: liveBook.passId }, { activatedAt: 1 }).lean();
    if (next?.activatedAt && tap.getTime() < new Date(next.activatedAt).getTime()) {
      return { passId: book.passId, turfId: book._id, effortId };
    }
  }
  return today;
};
