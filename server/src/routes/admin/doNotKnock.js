import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Household } from '../../models/Household.js';
import { User } from '../../models/User.js';
import { DoNotKnockAddress } from '../../models/DoNotKnockAddress.js';
import { clearDoNotKnock, nearMissAddresses, newResidentsSince } from '../../services/dnc/doNotKnock.js';

// The do-not-knock REVIEW surface: the org-wide register of suppressed addresses.
//
// ORG-LEVEL and ADMINS-ONLY, for the same two reasons as the DNC upload router next door. The
// record has no campaignId to nest under (an address request transcends campaigns — nesting would
// falsely imply scope), and the LIST is org-wide, so a team lead reading it would see addresses
// from campaigns they don't manage. Leads still SET and CLEAR — on doors in campaigns they manage,
// via /admin/households/:householdId/do-not-knock, which is campaign-scoped per request.
//
// The record-id DELETE here is not a convenience duplicate of that route: after a campaign is
// deleted, a suppression can outlive every Household row that carried the address (that survival
// is the point of the model), and at that moment there is no householdId to address it by. This
// is the only way to lift such a request.
const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));

function activeOrgId(req) {
  return req.activeOrg?._id;
}
function ensureOrgScoped(req, res) {
  if (!activeOrgId(req)) {
    res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
    return false;
  }
  return true;
}

// The register, newest first. Each row carries live door counts and — the reason this list exists
// — a `newResidents` count: how many voters have been imported at that address SINCE the request
// was recorded. A do-not-knock request never auto-reopens (deliberately), so turnover is
// invisible unless something surfaces it. This is that something; a human still decides.
router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const search = String(req.query.search || '').trim();

    const filter = { organizationId: orgId };
    if (search) {
      // Escaped: an address search box must never be able to inject a regex.
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { addressLine1: { $regex: safe, $options: 'i' } },
        { city: { $regex: safe, $options: 'i' } },
        { zipCode: { $regex: safe, $options: 'i' } },
      ];
    }

    const [total, records] = await Promise.all([
      DoNotKnockAddress.countDocuments(filter),
      DoNotKnockAddress.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    // Bulk-resolve the page's authors and live doors — never per-row queries.
    const userIds = [...new Set(records.map((r) => String(r.byUserId)).filter(Boolean))];
    const [users, doors, newResidents] = await Promise.all([
      User.find({ _id: { $in: userIds } }, { firstName: 1, lastName: 1 }).lean(),
      Household.find(
        { organizationId: orgId, normalizedAddress: { $in: records.map((r) => r.normalizedAddress) } },
        { normalizedAddress: 1, campaignId: 1 }
      ).lean(),
      newResidentsSince(orgId, records),
    ]);

    const userById = new Map(users.map((u) => [String(u._id), u]));
    const doorsByAddr = new Map();
    for (const d of doors) {
      const k = d.normalizedAddress;
      doorsByAddr.set(k, (doorsByAddr.get(k) || 0) + 1);
    }

    res.json({
      total,
      page,
      limit,
      records: records.map((r) => {
        const u = userById.get(String(r.byUserId));
        return {
          id: String(r._id),
          addressLine1: r.addressLine1,
          addressLine2: r.addressLine2,
          city: r.city,
          state: r.state,
          zipCode: r.zipCode,
          reason: r.reason,
          source: r.source,
          at: r.at,
          by: u ? { id: String(u._id), name: `${u.firstName || ''} ${u.lastName || ''}`.trim() } : null,
          // Live doors carrying this address right now, across every campaign. 0 is normal and
          // not an error — the campaign that held it may have been deleted, and the request
          // deliberately outlived it.
          doors: doorsByAddr.get(r.normalizedAddress) || 0,
          newResidents: newResidents.get(r.normalizedAddress) || 0,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// Advisory only — addresses that look like the same place under the LOOSE key but differ under
// the exact one, so the sibling fan-out never reached them. We show them; an admin decides.
// Never auto-applied: a loose-key coincidence would darken a neighbour's door with nobody to
// notice. `truncated` means the ZIP scan hit its cap, so "no matches" is not proof of none.
router.get('/:id/near-misses', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const record = await DoNotKnockAddress.findOne({ _id: id, organizationId: activeOrgId(req) }).lean();
    if (!record) return res.status(404).json({ error: 'Record not found' });

    const { matches, truncated } = await nearMissAddresses(activeOrgId(req), record);
    res.json({
      truncated,
      matches: matches.map((m) => ({
        householdId: String(m._id),
        campaignId: m.campaignId ? String(m.campaignId) : null,
        addressLine1: m.addressLine1,
        addressLine2: m.addressLine2,
        city: m.city,
        state: m.state,
        zipCode: m.zipCode,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Lift a request by record id. The only path that works once the address has no live doors left.
router.delete('/:id', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const record = await DoNotKnockAddress.findOne(
      { _id: id, organizationId: activeOrgId(req) },
      { normalizedAddress: 1 }
    ).lean();
    if (!record) return res.status(404).json({ error: 'Record not found' });

    const result = await clearDoNotKnock({
      organizationId: activeOrgId(req),
      normalizedAddress: record.normalizedAddress,
    });
    res.json({ cleared: result.cleared, doorsAffected: result.doorsAffected });
  } catch (err) {
    next(err);
  }
});

export default router;
