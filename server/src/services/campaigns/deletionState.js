import { Campaign } from '../../models/Campaign.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';

// Campaign hard-delete runs as a background job (deleteCampaignProcessor.js), and the campaign
// doc itself is the job record — `deletion.requestedAt` set means the campaign is mid-delete (or
// its delete FAILED and it may be half-destroyed). Either way it must be quarantined: spread
// NOT_DELETING into every query that resolves or lists campaigns, so a deleting campaign reads
// as gone (404 / absent) everywhere except the admin campaigns list, which surfaces it as
// "Deleting…". A `failed` deletion stays quarantined on purpose — the only exits are Retry
// (re-stamp + re-enqueue) or completion (the row is gone).
export const NOT_DELETING = { 'deletion.requestedAt': null };

export const isDeleting = (campaign) => !!campaign?.deletion?.requestedAt;

// Stuck-deletion expiry, mirroring sweepStaleImports: 'pending' means no worker ever claimed
// it (safe to call dead quickly); 'running' means the worker died mid-cascade — the processor
// heartbeats every 30s even through a multi-minute deleteMany, so minutes of silence is death.
const UNCLAIMED_MS = 2 * 60 * 1000;
const STALE_MS = 3 * 60 * 1000;

function staleReason(status) {
  return status === 'pending'
    ? 'No worker picked this delete up. The worker dyno may be off — retry once it is running.'
    : 'The worker stopped responding mid-delete. Retry to finish removing this campaign.';
}

function isStaleDeletion(campaign, now = Date.now()) {
  const d = campaign?.deletion;
  if (!d?.requestedAt || !['pending', 'running'].includes(d.status)) return false;
  const last = d.status === 'pending' ? d.requestedAt : d.heartbeatAt || d.requestedAt;
  const limit = d.status === 'pending' ? UNCLAIMED_MS : STALE_MS;
  return now - new Date(last).getTime() > limit;
}

/**
 * CAS-expire one deletion if its heartbeat lapsed, flipping it to 'failed' so the Campaigns
 * page shows Retry. Called from GET /admin/campaigns per poll — the web dyno enforces the
 * timeout precisely because the worker is the thing that's dead in this failure (the
 * maybeExpireStaleImportJob pattern). The status+heartbeat guard leaves a run that progressed
 * between our read and this write alone. Returns true if this call expired it.
 */
export async function maybeExpireStaleDeletion(campaign) {
  if (!isStaleDeletion(campaign)) return false;
  const res = await Campaign.updateOne(
    {
      _id: campaign._id,
      'deletion.status': campaign.deletion.status,
      'deletion.heartbeatAt': campaign.deletion.heartbeatAt ?? null,
    },
    { $set: { 'deletion.status': 'failed', 'deletion.error': staleReason(campaign.deletion.status) } }
  );
  return res.modifiedCount > 0;
}

// True once the campaign has any canvassing history — gates the type flip (which
// would corrupt door-status resolution + orphan responses) and hard delete. Lives
// here (not in routes/admin/campaigns.js) because the delete processor re-checks it
// at claim time, and routes must not import from routes.
export async function campaignHasCanvassed(campaignId) {
  return Boolean(
    (await CanvassActivity.exists({ campaignId })) || (await SurveyResponse.exists({ campaignId }))
  );
}

/**
 * Platform-wide health for the super-admin retention banner (routes/superAdmin/access.js):
 * `failed` deletions need a human (the org admin may never revisit their Campaigns page to see
 * the Retry), and `stuck` counts pending/running rows whose heartbeat lapsed well past the
 * poll-side expiry window — a deletion nobody is watching. Campaign volume is a few hundred
 * docs platform-wide, so these unindexed counts are fine.
 */
export async function campaignDeletionHealth() {
  const cutoff = new Date(Date.now() - 2 * STALE_MS);
  const [failed, stuck] = await Promise.all([
    Campaign.countDocuments({ 'deletion.status': 'failed' }),
    Campaign.countDocuments({
      'deletion.status': { $in: ['pending', 'running'] },
      'deletion.requestedAt': { $lte: cutoff },
      $or: [{ 'deletion.heartbeatAt': null }, { 'deletion.heartbeatAt': { $lte: cutoff } }],
    }),
  ]);
  return { healthy: failed === 0 && stuck === 0, failed, stuck };
}
