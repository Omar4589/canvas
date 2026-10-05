import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Campaign } from '../../models/Campaign.js';
import { NOT_DELETING } from '../../services/campaigns/deletionState.js';
import { Household } from '../../models/Household.js';
import { requireAuth, requireCampaignManager } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { requireActiveCampaign } from '../../middleware/campaignWritable.js';
import { updateHouseholdLocation } from '../../services/households/updateHouseholdLocation.js';
import { effectivePinSuspect } from '../../services/households/pinState.js';
import {
  confirmHouseholdLocation,
  isConfirmable,
  NEEDS_PIN_FIX,
  PIN_CHANGED,
  UNPLACED_PIN,
} from '../../services/households/confirmHouseholdLocation.js';
import { buildingKeyForCoords } from '../../utils/buildingKey.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';

// Campaign-nested household admin actions: correcting a door's pin
// (PATCH .../households/:householdId/location), vouching an approximate pin in place
// (POST .../households/:householdId/confirm-location), and the Pin Fixes queue read
// (GET .../households/pin-fixes). Mounted at /admin/campaigns/:campaignId/households
// (mergeParams to read :campaignId). requireActiveCampaign gates only the writes, so the
// queue stays readable on an archive.
const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireCampaignManager);
// Archived campaign ⇒ read-only: a finished race's pins stay where the field left them.
router.use(requireActiveCampaign());

// Record-level audit tag for :householdId (same pattern as routes/admin/turfs.js and
// routes/admin/households.js) — the pin PATCH is a single-record write, so a staff request
// under a grant logs WHICH door was moved.
router.param('householdId', (req, res, next, householdId) => {
  if (mongoose.isValidObjectId(householdId)) addAuditSubjects(res, 'household', householdId);
  next();
});

function activeOrgId(req) {
  return req.activeOrg?._id;
}

const locationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  scope: z.enum(['unit', 'building']).optional(),
});

// Shared by the pin routes: resolve the org-scoped campaign (a mid-delete campaign reads as
// gone — services/campaigns/deletionState.js) and the household inside it. Sends the 4xx and
// returns null when anything is off.
async function loadCampaignHousehold(req, res) {
  const orgId = activeOrgId(req);
  if (!orgId) {
    res.status(400).json({ error: 'Active organization required' });
    return null;
  }
  if (!mongoose.isValidObjectId(req.params.campaignId) || !mongoose.isValidObjectId(req.params.householdId)) {
    res.status(400).json({ error: 'Invalid id' });
    return null;
  }
  const campaign = await Campaign.findOne({ _id: req.params.campaignId, organizationId: orgId, ...NOT_DELETING }).lean();
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return null;
  }
  const household = await Household.findOne({
    _id: req.params.householdId,
    campaignId: campaign._id,
    organizationId: orgId,
  });
  if (!household) {
    res.status(404).json({ error: 'Household not found' });
    return null;
  }
  return { orgId, campaign, household };
}

// The Pin Fixes queue: every active door whose geocode is interpolated and no human has
// vouched for — the SAME predicate the campaigns-rollup badge counts (NEEDS_PIN_FIX), so the
// badge, this list, and the page's map can never disagree. Registered before the :householdId
// routes so the literal path never reads as an id.
router.get('/pin-fixes', async (req, res, next) => {
  try {
    const orgId = activeOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Active organization required' });
    if (!mongoose.isValidObjectId(req.params.campaignId)) return res.status(400).json({ error: 'Invalid id' });
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, organizationId: orgId, ...NOT_DELETING }).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Env override read at call time (test/ops), same posture as the turf caps. The needs-fixing
    // set is a fraction of any campaign's doors; the cap is a backstop, not a page size — the
    // page's list and map both want the whole set at once (the TurfsPage hybrid pattern), so this
    // copies /map's cap + truncated convention rather than the admin tables' pager.
    const cap = Number(process.env.PIN_FIX_LIST_CAP) > 0 ? Number(process.env.PIN_FIX_LIST_CAP) : 10000;
    // Two disjoint sets, two queries (each rides its own partial index), merged: approximate geocodes
    // nobody vouched for, and doors on a map spot shared with other addresses (UNPLACED_PIN). The cap
    // applies to the sum.
    const scopeFilter = { organizationId: orgId, campaignId: campaign._id };
    const projection = 'addressLine1 addressLine2 city state zipCode location status coordSource coordConfidence pinSuspect locationConfirmedAt';
    const [approx, unplaced, approxTotal, unplacedTotal] = await Promise.all([
      Household.find({ ...scopeFilter, ...NEEDS_PIN_FIX }, projection).sort({ addressLine1: 1, _id: 1 }).limit(cap).lean(),
      Household.find({ ...scopeFilter, ...UNPLACED_PIN }, projection).sort({ addressLine1: 1, _id: 1 }).limit(cap).lean(),
      Household.countDocuments({ ...scopeFilter, ...NEEDS_PIN_FIX }),
      Household.countDocuments({ ...scopeFilter, ...UNPLACED_PIN }),
    ]);
    const rows = [...approx, ...unplaced]
      .sort((a, b) => (a.addressLine1 < b.addressLine1 ? -1 : a.addressLine1 > b.addressLine1 ? 1 : String(a._id) < String(b._id) ? -1 : 1))
      .slice(0, cap);
    const total = approxTotal + unplacedTotal;
    return res.json({
      households: rows.map((h) => {
        const pinSuspect = effectivePinSuspect(h);
        return {
          id: String(h._id),
          addressLine1: h.addressLine1,
          addressLine2: h.addressLine2 || null,
          city: h.city,
          state: h.state,
          zipCode: h.zipCode,
          location: h.location?.coordinates
            ? { lng: h.location.coordinates[0], lat: h.location.coordinates[1] }
            : null,
          status: h.status,
          coordSource: h.coordSource || null,
          coordConfidence: h.coordConfidence || null,
          // On a map spot shared with other addresses ('placeholder' | 'stray'); absent otherwise.
          ...(pinSuspect ? { pinSuspect } : {}),
        };
      }),
      total,
      truncated: total > rows.length,
      cap,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/:householdId/location', async (req, res, next) => {
  try {
    const loaded = await loadCampaignHousehold(req, res);
    if (!loaded) return;
    const { household } = loaded;

    const data = locationSchema.parse(req.body);
    try {
      const { updated, moved, turfsRecomputed } = await updateHouseholdLocation(
        household,
        { lat: data.lat, lng: data.lng },
        { source: 'admin_drag', byUserId: req.user._id, scope: data.scope || 'unit' }
      );
      const h = updated[0];
      const pinSuspect = effectivePinSuspect(h);
      return res.json({
        household: {
          id: String(h._id),
          location: h.location ? { lng: h.location.coordinates[0], lat: h.location.coordinates[1] } : null,
          coordSource: h.coordSource,
          coordConfidence: h.coordConfidence,
          correctedAt: h.correctedAt,
          ...(pinSuspect ? { pinSuspect } : {}),
        },
        // 0 when the save moved nothing (still on an unplaced home's own pin, or back onto the spot a
        // placed home left): the client says "Nothing moved" instead of "Pin moved".
        moved,
        // Books whose outline was redrawn around the new spot (display-only; [] when none).
        turfsRecomputed,
      });
    } catch (err) {
      if (err.code === 'out_of_bounds' || err.code === 'invalid_coords') {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      throw err;
    }
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

const confirmSchema = z.object({
  confirmed: z.boolean().optional(), // default true; false = undo the vouch
  scope: z.enum(['unit', 'building']).optional(),
  // The pin Pin Fixes displayed ([lng, lat]). When the door has since moved to another ~1.1m spot
  // (a placement by address, another lead), the confirm is refused instead of vouching for a pin
  // nobody saw. Undo doesn't send it.
  expectedCoordinates: z.tuple([z.number(), z.number()]).optional(),
});

// Vouch an approximate pin IN PLACE (Pin Fixes): the manager checked the spot and it's right,
// so the door leaves the needs-fixing queue and the amber ring without a fabricated move.
// Deliberately NOT the location PATCH — nothing moves and coordSource must stay honest
// (services/households/confirmHouseholdLocation.js has the full rationale).
router.post('/:householdId/confirm-location', async (req, res, next) => {
  try {
    const loaded = await loadCampaignHousehold(req, res);
    if (!loaded) return;
    const { household } = loaded;

    const data = confirmSchema.parse(req.body || {});
    const confirmed = data.confirmed !== false;
    // The pin the page showed must still be this door's pin — compared BEFORE the eligibility
    // guard, or a home placed by address after the page loaded would get NOT_APPROXIMATE instead.
    // Its own code, because this router's other 409s mean an archived or deleting campaign.
    if (
      data.expectedCoordinates &&
      buildingKeyForCoords(data.expectedCoordinates) !== buildingKeyForCoords(household.location?.coordinates)
    ) {
      return res.status(409).json({ error: 'This pin changed since the page loaded — reloading.', code: PIN_CHANGED });
    }
    // Confirming a door that was never approximate nor on a shared spot would log a verification of
    // nothing — refuse it. The undo path skips the check so a stray stamp can always be cleared.
    if (confirmed && !isConfirmable(household)) {
      return res.status(400).json({
        error: 'This door’s pin is not an approximate geocode or a shared map spot, so there is nothing to confirm.',
        code: 'NOT_APPROXIMATE',
      });
    }

    let updated;
    try {
      ({ updated } = await confirmHouseholdLocation(household, {
        byUserId: req.user._id,
        scope: data.scope || 'unit',
        confirmed,
      }));
    } catch (err) {
      if (err.code === PIN_CHANGED) return res.status(409).json({ error: err.message, code: PIN_CHANGED });
      throw err;
    }
    const primary = updated.find((d) => String(d._id) === String(household._id));
    return res.json({
      household: {
        id: String(household._id),
        locationConfirmedAt: primary ? primary.locationConfirmedAt || null : household.locationConfirmedAt || null,
      },
      // Doors actually stamped/unstamped (building scope fans out to the units of the same street
      // address on the same ~1.1m pin that need a vouch; already-vouched doors don't re-count).
      updated: updated.length,
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

export default router;
