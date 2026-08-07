import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireCampaignManager } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { NOT_DELETING } from '../../services/campaigns/deletionState.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { SavedSearch } from '../../models/SavedSearch.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';
import { buildPacket, countPacketDoors, PACKET_DOOR_CAP } from '../../services/packet/buildPacket.js';

// Printable walk packets. Read-only: this router assembles paper and writes nothing.
// The PDF itself is rendered in the admin's browser (client/src/lib/packet/packetPdf.js),
// so no artifact is stored, no queue is involved, and no third party sees the data.
const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireCampaignManager);

async function loadCampaign(req, res, next) {
  try {
    const orgId = req.activeOrg?._id;
    if (!orgId) return res.status(400).json({ error: 'Active organization required' });
    if (!mongoose.isValidObjectId(req.params.campaignId)) {
      return res.status(400).json({ error: 'Invalid campaignId' });
    }
    const campaign = await Campaign.findOne({
      _id: req.params.campaignId,
      organizationId: orgId,
      ...NOT_DELETING,
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    req.campaign = campaign;
    next();
  } catch (err) {
    next(err);
  }
}
router.use(loadCampaign);

const idList = (v) =>
  (Array.isArray(v) ? v : String(v || '').split(','))
    .map((s) => String(s).trim())
    .filter((s) => mongoose.isValidObjectId(s));

// What can be printed: published books on active rounds, plus saved searches.
router.get('/sources', async (req, res, next) => {
  try {
    const campaignId = req.campaign._id;
    const passes = await Pass.find(
      { campaignId, status: { $in: ['active', 'draft'] } },
      { name: 1, roundNumber: 1, status: 1, effortId: 1 }
    )
      .sort({ roundNumber: 1 })
      .lean();

    const turfs = await Turf.find(
      { campaignId, status: 'published' },
      { name: 1, passId: 1, doorCount: 1, householdIds: 1 }
    ).lean();

    const assignments = await TurfAssignment.find({ campaignId })
      .populate('userId', 'firstName lastName')
      .lean();
    const assignedByTurf = new Map();
    for (const a of assignments) {
      if (!a.userId) continue;
      const k = String(a.turfId);
      const arr = assignedByTurf.get(k) || [];
      arr.push(`${(a.userId.firstName || '').charAt(0)}. ${a.userId.lastName || ''}`.trim());
      assignedByTurf.set(k, arr);
    }

    const byPass = new Map(passes.map((p) => [String(p._id), []]));
    for (const t of turfs) {
      const arr = byPass.get(String(t.passId));
      if (!arr) continue; // a book on an archived round — not offered for printing
      arr.push({
        id: String(t._id),
        name: t.name,
        // doorCount is the cut-time count; the live knockable number is resolved at
        // generation, so the picker labels this as approximate rather than promising it.
        doorCount: t.doorCount || (t.householdIds || []).length,
        assignedTo: (assignedByTurf.get(String(t._id)) || []).join(', ') || null,
      });
    }

    const walkLists = await SavedSearch.find(
      { campaignId },
      { name: 1, householdCount: 1, voterCount: 1, createdAt: 1 }
    )
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      cap: PACKET_DOOR_CAP,
      hasSurvey: !!req.campaign.surveyTemplateId && req.campaign.type !== 'lit_drop',
      rounds: passes.map((p) => ({
        id: String(p._id),
        name: p.name,
        roundNumber: p.roundNumber,
        status: p.status,
        books: (byPass.get(String(p._id)) || []).sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true })
        ),
      })),
      walkLists: walkLists.map((w) => ({
        id: String(w._id),
        name: w.name,
        doorCount: w.householdCount || 0,
        voterCount: w.voterCount || 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// The packet payload. The browser renders the PDF from exactly this.
router.get('/data', async (req, res, next) => {
  try {
    const { walkListId, turfIds, includePhone } = req.query;
    const source = walkListId
      ? { kind: 'walklist', walkListId: String(walkListId) }
      : { kind: 'books', turfIds: idList(turfIds) };

    if (source.kind === 'walklist' && !mongoose.isValidObjectId(source.walkListId)) {
      return res.status(400).json({ error: 'Invalid walkListId' });
    }
    if (source.kind === 'books' && !source.turfIds.length) {
      return res.status(400).json({ error: 'Select at least one book' });
    }

    // Refuse over the cap rather than truncating. A silently short packet means doors
    // nobody knocks and nobody notices — and on paper there is no coverage report to
    // catch it later.
    const doorCount = await countPacketDoors(req.campaign, source);
    if (doorCount > PACKET_DOOR_CAP) {
      return res.status(409).json({
        error: 'packet-too-large',
        doorCount,
        cap: PACKET_DOOR_CAP,
        message: `That's ${doorCount.toLocaleString()} doors — about ${Math.ceil(
          doorCount / 4
        ).toLocaleString()} sheets. Print these in two batches.`,
      });
    }

    const payload = await buildPacket(req.campaign, req.activeOrg?.name || '', source, {
      includePhone: includePhone === '1' || includePhone === 'true',
    });

    // Record-level audit: the subjects are the voters actually printed (post-suppression).
    // Writes a row only when a Doorline staffer is reaching in under a support grant —
    // a customer admin reading their own data logs nothing, by design (middleware/accessLog.js).
    addAuditSubjects(
      res,
      'voter',
      payload.books.flatMap((b) => b.doors.flatMap((d) => d.voters.map((v) => v.id)))
    );

    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
