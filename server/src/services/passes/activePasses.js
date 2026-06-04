import { Pass } from '../../models/Pass.js';

// A campaign's active ROUNDS are the Pass docs with status 'active' — one per
// active effort, so there can be several. This replaces the old single
// Campaign.activePassId cache (Pass.status is the source of truth).
export async function activePassIds(campaignId) {
  const passes = await Pass.find({ campaignId, status: 'active' }, { _id: 1 }).lean();
  return passes.map((p) => p._id);
}

// The active round id for one effort (at most one), or null.
export async function activePassIdForEffort(effortId) {
  const pass = await Pass.findOne({ effortId, status: 'active' }, { _id: 1 }).lean();
  return pass?._id || null;
}
