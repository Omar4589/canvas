import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { CampaignChange } from '../../models/CampaignChange.js';
import { AnswerEditRun } from '../../models/AnswerEditRun.js';
import { AnswerEditRunChunk } from '../../models/AnswerEditRunChunk.js';
import { UnknockRun } from '../../models/UnknockRun.js';
import { UnknockRunChunk } from '../../models/UnknockRunChunk.js';
import { SurveyConversionRun } from '../../models/SurveyConversionRun.js';
import { ConversionStrike } from '../../models/ConversionStrike.js';
import { ReclassifyRun } from '../../models/ReclassifyRun.js';

// Door Outcomes writes that land after a delete cascade has swept past them.
//
// A conversion, an answer edit and their undos each stop at their next batch once their campaign or
// organization is being deleted; an unknock and its undo stop only when the cascade deletes their run
// (the strike's next beat misses, the undo's last save fails), and a relabel is one inline write — those
// are swept after (round 6: this said the unknock stopped at its next batch too). Both cascades wait
// (bounded) for a batch already in flight before they sweep, then sweep these collections once more at
// the end. A batch that stalls
// past all of that — a database pause longer than the wait — still writes after the last sweep, and
// what it wrote outlived the deletion (code review 2026-10-19, round 3: three surveys of a deleted
// organization were left behind).
//
// So every writer asks again AFTER it writes, however it ends (sweptAfter): a cascade is marked as
// begun before its first sweep and its tenant's document goes last, so a write the cascade missed is
// always followed by a check that sees one or the other — and then sweeps what the cascade would have.
// Only a cascade that has BEGUN (or a tenant already gone) counts, never the bare request: a deletion
// still `pending` is undone when its job can't be queued (the routes clear the stamp), and sweeping
// then destroyed a tenant nobody deleted. Begun means `running` for an organization (its processor
// refuses nothing once it claims) and `running` with `cascadeAt` for a campaign, whose processor can
// still refuse after it claims — canvassing started, or the organization is being deleted — and a
// sweep in that gap removed Door Outcomes work from a campaign that then stayed (round 4). A cascade
// that failed leaves its leftovers to its Retry, which sweeps them with the rest.

// What a Door Outcomes write can add to, and what both cascades sweep last.
export const LATE_WRITE_MODELS = [
  SurveyResponse, CanvassActivity, SurveyResponseArchive, CampaignChange, AnswerEditRun, AnswerEditRunChunk,
  UnknockRun, UnknockRunChunk, SurveyConversionRun, ConversionStrike, ReclassifyRun,
];

/** The tenant whose delete cascade is running (or done), as a filter — { organizationId } or { campaignId } — or null. */
export const deletingTenant = async ({ campaignId, organizationId }) => {
  const [campaign, org] = await Promise.all([
    Campaign.findById(campaignId, { deletion: 1 }).lean(),
    Organization.findById(organizationId, { deletion: 1 }).lean(),
  ]);
  if (!org || org.deletion?.status === 'running') return { organizationId };
  if (!campaign || (campaign.deletion?.status === 'running' && campaign.deletion?.cascadeAt)) return { campaignId };
  return null;
};

/** Has a deletion of this campaign or organization been asked for (a writer stops at its next batch)? */
export const deletionRequested = async ({ campaignId, organizationId }) => {
  const [campaign, org] = await Promise.all([
    Campaign.findById(campaignId, { deletion: 1 }).lean(),
    Organization.findById(organizationId, { deletion: 1 }).lean(),
  ]);
  return !campaign || !org || !!campaign.deletion?.requestedAt || !!org.deletion?.requestedAt;
};

/**
 * Sweep what a Door Outcomes writer may have just added, when its campaign's or organization's delete
 * cascade is running. Returns true when it swept (the writer stops there: its own run is gone too).
 */
export const sweepIfDeleting = async (tenant) => {
  const scope = await deletingTenant(tenant);
  if (!scope) return false;
  for (const M of LATE_WRITE_MODELS) await M.deleteMany(scope);
  return true;
};

/**
 * Run a writer, then sweep if its tenant is being deleted — however it ended: a batch that stalled
 * past the cascade writes, and then fails saving its own run (the cascade deleted it), so a check
 * only on the way out of a finished writer never ran (round 3).
 */
export const sweptAfter = async (tenant, fn) => {
  try {
    return await fn();
  } finally {
    await sweepIfDeleting(tenant).catch((err) => console.error('[late-write-sweep] failed:', err?.message || err));
  }
};
