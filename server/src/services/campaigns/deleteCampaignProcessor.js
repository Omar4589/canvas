import { UnrecoverableError } from 'bullmq';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { deleteCampaignCascade } from './deleteCampaign.js';
import { campaignHasCanvassed } from './deletionState.js';

// Campaign hard-delete, on the worker dyno. The web route (routes/admin/campaigns.js) stamps
// `campaign.deletion` and enqueues; the campaign doc itself is the job record — success is the
// row being GONE (the cascade's last line deletes it), so this processor never writes a
// "completed" state. Idempotent: the cascade converges on re-run and the platform-stats bank
// is claim-guarded, so BullMQ retries after a crash are safe.
//
// Known razor-thin race, accepted: a knock whose campaign check passed just before the stamp
// landed can insert one CanvassActivity row mid-cascade (after that collection's deleteMany).
// Every request-entry path re-checks the deletion stamp, so the window is sub-second.
export async function processCampaignDeleteJob(job) {
  const campaignId = job.data?.campaignId;
  const campaign = campaignId ? await Campaign.findById(campaignId) : null;
  // Stale redelivery after the delete finished (or a bogus id) is a safe no-op.
  if (!campaign) return;

  // Claim: flip to running. Accepts pending (normal), failed (retry attempt 2+ — the catch
  // below marked it), and running (stalled-job redelivery). The one refusal is an UNSTAMPED
  // doc — the route's enqueue-failure path clears the stamp, and a stray redelivery must
  // never delete a campaign nobody asked to delete.
  const claimed = await Campaign.findOneAndUpdate(
    { _id: campaign._id, 'deletion.requestedAt': { $ne: null } },
    { $set: { 'deletion.status': 'running', 'deletion.heartbeatAt': new Date(), 'deletion.error': null } },
    { new: true }
  );
  if (!claimed) return;

  const failWith = (message) =>
    Campaign.updateOne(
      // Status guard: never stomp a fresh `pending` re-stamp from an admin retry racing us.
      { _id: campaign._id, 'deletion.status': 'running' },
      { $set: { 'deletion.status': 'failed', 'deletion.error': message } }
    ).catch(() => {});

  // Re-check the delete gate at claim time: a knock/survey can land in the gap between the
  // route's check and this job running, and we never destroy real canvassing history.
  if (await campaignHasCanvassed(campaign._id)) {
    const msg = 'Canvassing started before the delete ran — archive this campaign instead.';
    await failWith(msg);
    throw new UnrecoverableError(msg);
  }

  // The whole ORG is being deleted. Stand down — its cascade owns these rows now, and running
  // both concurrently is not merely redundant, it corrupts two things:
  //   1. DncPendingId. This cascade UPSERTS a parked row (organizationId + stateVoterId) for a
  //      flagged person losing their last voter row. DncPendingId is in the org cascade's
  //      ORG_SCOPED sweep — so parking one AFTER that sweep passed leaves a real person's state
  //      voter id, held precisely because they asked never to be contacted, surviving the
  //      deletion of the organization that held it.
  //   2. The platform counters. captureOrgBeforeDelete has already banked this campaign's rows
  //      into the permanent `deleted` bucket; captureCampaignBeforeDelete would bank them a
  //      second time, and the nightly reconcile only ever recomputes `live`.
  // This is the only window that matters: a job enqueued before the org stamp landed. The route
  // is already unreachable by then — middleware/orgContext.js walls the whole tenant.
  if (await Organization.exists({ _id: claimed.organizationId, 'deletion.requestedAt': { $ne: null } })) {
    const msg = 'The organization is being deleted — its campaigns go with it.';
    await failWith(msg);
    throw new UnrecoverableError(msg); // never retry: the org cascade removes these rows regardless
  }

  // Liveness rides a timer, not just cascade stage boundaries: Voter/Household/VotedVoter
  // deleteMany are single multi-minute awaits with no boundary inside, and the poll-side
  // expiry (deletionState.js) calls 3 minutes of silence death. The event loop is free
  // during those awaits, so the timer fires; a real OOM/SIGKILL stops it, which is exactly
  // the failure the expiry exists to catch.
  const writeHeartbeat = () =>
    Campaign.updateOne(
      { _id: campaign._id, 'deletion.status': 'running' },
      { $set: { 'deletion.heartbeatAt': new Date() } }
    ).catch(() => {});
  const hbTimer = setInterval(writeHeartbeat, 30_000);
  hbTimer.unref?.();
  // Stage-boundary callback, throttled to ≤1 write/sec (the exportProcessor progress pattern)
  // so tight chunk loops don't hammer the campaign doc between timer ticks.
  let lastBeatAt = 0;
  const heartbeat = () => {
    const now = Date.now();
    if (now - lastBeatAt < 1000) return;
    lastBeatAt = now;
    writeHeartbeat();
  };

  try {
    const counts = await deleteCampaignCascade(claimed, { heartbeat });
    console.log(`[campaign-delete] ${campaign._id} deleted`, counts);
  } catch (err) {
    // Mark failed on EVERY attempt (a queue retry flips it back to running via the claim
    // above, so the row never lies for long). Generic message — never echo voter data.
    console.error(`[campaign-delete] ${campaign._id} failed:`, err?.message || err);
    await failWith('The delete stopped partway. Retry to finish removing this campaign.');
    throw err;
  } finally {
    clearInterval(hbTimer);
  }
}
