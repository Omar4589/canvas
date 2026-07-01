import { Pass } from '../../models/Pass.js';

/**
 * Create the next draft pass for an effort. `roundNumber` auto-increments PER EFFORT,
 * with an E11000 retry so a concurrent create racing on the unique (effortId, roundNumber)
 * index resolves cleanly. A blank `name` auto-labels the pass "Pass {roundNumber}" so
 * one-click creation needs no naming step (admins can rename a draft later).
 *
 * Shared by the passes route (explicit "New pass") and the efforts route (auto Pass 1 on
 * walk-list creation). Returns the created Pass, or null if a number couldn't be allocated.
 */
export async function createNextPass({ organizationId, campaignId, effortId, name, userId }) {
  let pass = null;
  for (let attempt = 0; attempt < 5 && !pass; attempt += 1) {
    const last = await Pass.findOne({ effortId }).sort({ roundNumber: -1 }).select('roundNumber').lean();
    const roundNumber = (last?.roundNumber || 0) + 1;
    const label = (name && String(name).trim()) || `Pass ${roundNumber}`;
    try {
      pass = await Pass.create({
        organizationId,
        campaignId,
        effortId,
        roundNumber,
        name: label,
        status: 'draft',
        createdBy: userId || null,
      });
    } catch (err) {
      if (err.code === 11000) continue; // (effortId, roundNumber) race — retry
      throw err;
    }
  }
  return pass;
}
