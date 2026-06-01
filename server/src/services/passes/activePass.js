import { Pass } from '../../models/Pass.js';

// Only one pass is active per campaign at a time.
export function getActivePass(campaignId) {
  return Pass.findOne({ campaignId, status: 'active' }).lean();
}
