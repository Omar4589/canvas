import { CanvassActivity } from '../../models/CanvassActivity.js';
import { UnknockRunChunk } from '../../models/UnknockRunChunk.js';
import { Household } from '../../models/Household.js';

// The rows automatic pause reads (docs/PROPOSAL_PACE_PAUSE.md §C.3, §I). One loader for the live check, the
// review screens, the preview and the console replay, so they read the same fields the same way.

// What services/audit/paceRule.js entriesOf reads of a CanvassActivity row.
export const PACE_ROW_FIELDS = [
  '_id', 'householdId', 'campaignId', 'actionType', 'timestamp', 'createdAt', 'location', 'replaced',
  'wasOfflineSubmission', 'via', 'knockPin', 'reclassified',
];
const PROJECTION = PACE_ROW_FIELDS.join(' ');

// A canvasser's rows STANDING in a time range, oldest first. A standing row is always a door's latest
// entry, so every entry saved in the range is either one of these rows or in the history of one
// (`replaced.history`). Served by { userId: 1, timestamp: -1 }; always tenant-filtered.
export const loadStandingRows = (organizationId, userId, timestamp) =>
  CanvassActivity.find({ organizationId, userId, timestamp }, PROJECTION).sort({ timestamp: 1, _id: 1 }).lean();

// The same canvasser's rows frozen by Unknock runs (UnknockRunChunk.rows are verbatim CanvassActivity
// docs, untyped). Projected to the rule's fields inside the aggregation, so a frozen row's note never
// reaches this process. Chunks are rare, and the org filter rides the chunk's organizationId index.
export const loadFrozenRows = (organizationId, userId, timestamp) =>
  UnknockRunChunk.aggregate([
    { $match: { organizationId } },
    { $unwind: '$rows' },
    { $replaceRoot: { newRoot: '$rows' } },
    { $match: { userId, timestamp } },
    { $project: Object.fromEntries(PACE_ROW_FIELDS.map((f) => [f, 1])) },
  ]);

// How many frozen rows the same filter would load — for the preview's cap, counted before loading.
export const countFrozenRows = async (organizationId, userIds, timestamp) => {
  const [r] = await UnknockRunChunk.aggregate([
    { $match: { organizationId } },
    { $unwind: '$rows' },
    { $match: { 'rows.userId': { $in: userIds }, 'rows.timestamp': timestamp } },
    { $count: 'n' },
  ]);
  return r?.n || 0;
};

// Live and frozen rows, one per _id, the live row winning: an Unknock undo re-inserts the frozen rows with
// their original ids and keeps the chunks, and a visit struck twice sits in two runs' chunks.
export const mergeRows = (live, frozen) => {
  const byId = new Map();
  for (const r of frozen) byId.set(String(r._id), r);
  for (const r of live) byId.set(String(r._id), r);
  return [...byId.values()].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp) || String(a._id).localeCompare(String(b._id))
  );
};

// householdId → { addressLine1, addressLine2 }, for the rule's unit test (isUnitAddress).
export const loadUnitFacts = async (householdIds) => {
  const ids = [...new Set(householdIds.map(String))];
  if (!ids.length) return new Map();
  const rows = await Household.find({ _id: { $in: ids } }, 'addressLine1 addressLine2').lean();
  return new Map(rows.map((h) => [String(h._id), h]));
};
