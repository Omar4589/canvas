import { ClientReport } from '../../models/ClientReport.js';
import { Membership } from '../../models/Membership.js';
import { resolveSessionUser } from '../auth/resolveSessionUser.js';
import { plusOne } from './shareLinks.js';

// Who opened a client report (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F7). No new collection: the
// counts live on the report, in `views` — per share link, and members of the organization (by role)
// and Doorline staff separately, so "Opened via the Candidate link: about 2 visits" is never inflated
// by the operator checking their own work. No IP address, no device.
//
// An open is a ping the page sends once per report per browser per day, so a determined link holder
// could inflate it — hence "about". The share routes respond BEFORE this runs.

// A member's role → the bucket their opens count in. A lead who is the client shows under leads
// (the panel's tooltip says so).
const MEMBER_BUCKET = { admin: 'admins', lead: 'leads', canvasser: 'others' };

/**
 * The count an open belongs to. A Doorline session token, if the page sent one, is resolved with every
 * check requireAuth applies (services/auth/resolveSessionUser.js) and NEVER grants or refuses
 * anything: Doorline staff → members.staff; an active member of the LINK's organization → admins,
 * leads or others by role; anyone else — no session, an ended or stale one, a member of another
 * organization — counts under the link.
 */
export const openBucketFor = async ({ share, sessionToken = null }) => {
  if (sessionToken) {
    const { user } = await resolveSessionUser(sessionToken);
    if (user?.isSuperAdmin) return { members: 'staff' };
    if (user) {
      const membership = await Membership.findOne(
        { userId: user._id, organizationId: share.organizationId, isActive: true },
        { role: 1 }
      ).lean();
      if (membership) return { members: MEMBER_BUCKET[membership.role] || 'others' };
    }
  }
  return { link: String(share._id) };
};

/**
 * Count one open: ONE pipeline update on the report — counters read null as 0 (§F0: $inc on an
 * explicit null throws), the first and last dates through $min/$max (which skip a null), and
 * timestamps off, so an open never moves the report's updatedAt. The old viewCount/lastViewedAt
 * totals are FROZEN at what they were before per-link counts (§P3, ADMINUX-12): the panel's "N views
 * before per-link counts" is a before-the-upgrade number, so no open since may move it.
 */
export const recordReportOpen = async ({ report, share, sessionToken = null, now = new Date() }) => {
  const bucket = await openBucketFor({ share, sessionToken });
  const path = bucket.link ? `views.byLink.${bucket.link}` : `views.members.${bucket.members}`;
  const set = {
    [`${path}.opens`]: plusOne(`${path}.opens`),
    [`${path}.firstOpenedAt`]: { $min: [`$${path}.firstOpenedAt`, now] },
    [`${path}.lastOpenedAt`]: { $max: [`$${path}.lastOpenedAt`, now] },
  };
  await ClientReport.updateOne(
    { _id: report._id, organizationId: share.organizationId, campaignId: share.campaignId },
    [{ $set: set }],
    { timestamps: false }
  );
  return bucket;
};
