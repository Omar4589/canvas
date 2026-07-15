import { Organization } from '../../models/Organization.js';
import { Subscription } from '../../models/Subscription.js';
import { Campaign } from '../../models/Campaign.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';

// How long an org can sit at $0 and silent before it's surfaced for review.
export const PLATFORM_IDLE_MONTHS = Number(process.env.PLATFORM_IDLE_MONTHS || 6);
const MONTH = 30 * 86_400_000;

// The statuses the dormancy shield protects from auto-deletion. An org in one of these (or with no
// subscription record at all, which fails open to 'active') will NEVER be purged by the retention
// sweep — so if it is also $0 and abandoned, nothing else will ever catch it. That is the gap this
// surfaces.
const PAYING_STATUSES = new Set(['active', 'trial', 'past_due']);

/**
 * Orgs that LOOK active but are effectively abandoned: a paying/active status, ZERO non-archived
 * campaigns (so $0 billing, and no walk list to knock — meaning they cannot reset the dormancy clock),
 * and no canvassing activity for more than `months`. These can neither be auto-deleted (the shield) nor
 * self-recover (no campaign), so instead of running a silent clock we surface them for an account
 * manager to decide: re-engage, or terminate (set 'canceled' → the 60-day wind-down). Internal/demo
 * orgs are excluded (their subscription status is 'internal', which is not a paying status).
 *
 * A recently-created org is never flagged: with no activity, its clock is measured from createdAt, so a
 * customer still in setup (< `months` old) does not appear.
 */
export async function idleZeroDollarOrgs({ months = PLATFORM_IDLE_MONTHS } = {}) {
  const cutoff = new Date(Date.now() - months * MONTH);

  const [orgs, subs] = await Promise.all([
    Organization.find({ isActive: true }, 'name slug createdAt').lean(),
    Subscription.find({}, 'organizationId status').lean(),
  ]);
  const statusByOrg = new Map(subs.map((s) => [String(s.organizationId), s.status]));

  const idle = [];
  for (const org of orgs) {
    const status = statusByOrg.get(String(org._id)) || 'active'; // no record = active (fail-open)
    if (!PAYING_STATUSES.has(status)) continue; // internal/suspended/canceled are not zombies

    const activeCampaigns = await Campaign.countDocuments({ organizationId: org._id, isActive: true });
    if (activeCampaigns > 0) continue; // has a live campaign — in use, not abandoned

    const last = await CanvassActivity.findOne({ organizationId: org._id }, 'timestamp')
      .sort({ timestamp: -1 })
      .lean();
    const lastTouch = last?.timestamp || org.createdAt;
    if (new Date(lastTouch) > cutoff) continue; // touched recently, or created recently

    idle.push({
      organizationId: String(org._id),
      name: org.name,
      slug: org.slug,
      status,
      createdAt: org.createdAt,
      lastActivityAt: last?.timestamp || null,
      monthsIdle: Math.floor((Date.now() - new Date(lastTouch).getTime()) / MONTH),
    });
  }

  idle.sort((a, b) => b.monthsIdle - a.monthsIdle);
  return { months, orgs: idle };
}
