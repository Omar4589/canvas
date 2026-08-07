import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireCampaignManager } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { NOT_DELETING } from '../../services/campaigns/deletionState.js';
import { Pass } from '../../models/Pass.js';
import { Effort } from '../../models/Effort.js';
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

// What can be printed: published books on active AND draft rounds, plus saved searches.
// Draft is deliberate — a pass cannot be activated until its books are published, so
// "print the night before launch" is exactly the draft-pass / published-books state.
router.get('/sources', async (req, res, next) => {
  try {
    const campaignId = req.campaign._id;

    // Walk lists (the Effort model) are the top level a user picks from — a campaign runs
    // several in parallel, each with its own rounds, and a bare "Pass 3" doesn't say which.
    const efforts = await Effort.find({ campaignId }, { name: 1 }).sort({ createdAt: 1 }).lean();
    const effortNameById = new Map(efforts.map((e) => [String(e._id), e.name]));
    const effortRank = new Map(efforts.map((e, i) => [String(e._id), i]));

    const passes = await Pass.find(
      { campaignId, status: { $in: ['active', 'draft'] } },
      { name: 1, roundNumber: 1, status: 1, effortId: 1 }
    ).lean();
    // Group by walk list first, then by round — sorting on roundNumber alone interleaves
    // walk lists (A's Pass 1, B's Pass 1, A's Pass 2 …), which is unreadable.
    passes.sort(
      (a, b) =>
        (effortRank.get(String(a.effortId)) ?? 99) - (effortRank.get(String(b.effortId)) ?? 99) ||
        a.roundNumber - b.roundNumber
    );

    // Every non-archived book, in creation order — the ranking below must see the DRAFT
    // siblings too, or colours shift the moment a draft book is accepted.
    const turfs = await Turf.find(
      { campaignId, status: { $ne: 'archived' } },
      { name: 1, passId: 1, doorCount: 1, householdIds: 1, status: 1, boundary: 1, centroid: 1 }
    )
      .sort({ createdAt: 1 })
      .lean();

    // THE colour rule, assigned once, here. A book's colour is its position within its own
    // pass in creation order — identical to TurfsPage's `colorByTurf`. Every surface (this
    // picker, the studio map, the printed stripe) reads this number instead of using its own
    // array position, which is what previously gave one book three different colours.
    const perPass = new Map();
    const colorIndexByTurf = new Map();
    for (const t of turfs) {
      const k = String(t.passId);
      const n = perPass.get(k) || 0;
      colorIndexByTurf.set(String(t._id), n % 12);
      perPass.set(k, n + 1);
    }

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
      if (t.status !== 'published') continue; // ranked above, but a draft book can't be printed
      const arr = byPass.get(String(t.passId));
      if (!arr) continue; // a book on an archived round — not offered for printing
      arr.push({
        id: String(t._id),
        name: t.name,
        // doorCount is the cut-time count; the live knockable number is resolved at
        // generation, so the picker labels this as approximate rather than promising it.
        doorCount: t.doorCount || (t.householdIds || []).length,
        colorIndex: colorIndexByTurf.get(String(t._id)) ?? 0,
        assignedTo: (assignedByTurf.get(String(t._id)) || []).join(', ') || null,
        // Display-only geometry for the studio map. Polygon OR MultiPolygon — a book that
        // owns a door surrounded by another book grows pocket islands.
        boundary: t.boundary || null,
        centroid: t.centroid || null,
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
        effortId: p.effortId ? String(p.effortId) : null,
        // The label the whole picker hangs off. Matches TurfsPage's pass picker wording.
        effortName: effortNameById.get(String(p.effortId)) || 'Walk list',
        // Ordered by colour, i.e. by creation — the same order the Turfs map sidebar lists
        // them in, so the two screens read identically.
        books: (byPass.get(String(p._id)) || []).sort((a, b) => a.colorIndex - b.colorIndex),
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
    const { walkListId, turfIds, includePhone, excludeApartments } = req.query;
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
      excludeApartments: excludeApartments === '1' || excludeApartments === 'true',
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
