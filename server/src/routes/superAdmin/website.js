import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { DemoRequest } from '../../models/DemoRequest.js';
import { SiteVisitDay } from '../../models/SiteVisitDay.js';
import { visitDay } from '../../services/site/siteVisits.js';

// The public website, seen from the inside: /super-admin/website. Two things the marketing site
// produces and nothing else in the product does —
//   · demo requests (models/DemoRequest.js): every submission of the site's one form, saved before
//     its notice email so a failed send can't lose it; mark one handled, or delete it when the person
//     asks (Privacy Policy, "Demo requests"; it also expires on its own after 24 months);
//   · daily visit counts (models/SiteVisitDay.js): page loads of the public pages by day and source,
//     with no personal information in them.
// Super-admin only: prospects belong to no organization.
const router = Router();
router.use(requireAuth, requireSuperAdmin);

const shapeRequest = (r) => ({
  id: String(r._id),
  createdAt: r.createdAt,
  name: r.name,
  email: r.email,
  organization: r.organization,
  role: r.role,
  teamSize: r.teamSize,
  heardAbout: r.heardAbout,
  when: r.when,
  message: r.message,
  source: r.source,
  page: r.page,
  emailOutcome: r.emailOutcome,
  handledAt: r.handledAt,
  expiresAt: r.expiresAt,
});

const listSchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(['open', 'handled', 'all']).default('open'),
});

router.get('/demo-requests', async (req, res, next) => {
  try {
    const q = listSchema.parse(req.query);
    const filter = q.status === 'open' ? { handledAt: null } : q.status === 'handled' ? { handledAt: { $ne: null } } : {};
    const [total, rows, open] = await Promise.all([
      DemoRequest.countDocuments(filter),
      DemoRequest.find(filter).sort({ createdAt: -1 }).skip(q.skip).limit(q.limit).lean(),
      DemoRequest.countDocuments({ handledAt: null }),
    ]);
    res.json({ total, open, requests: rows.map(shapeRequest) });
  } catch (err) {
    next(err);
  }
});

const loadRequest = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ error: 'Invalid id' });
    return null;
  }
  const row = await DemoRequest.findById(req.params.id);
  if (!row) res.status(404).json({ error: 'Demo request not found', code: 'not-found' });
  return row;
};

// Handled ⇄ open. Who handled it is kept so two people working the inbox don't both reply.
router.patch('/demo-requests/:id', async (req, res, next) => {
  try {
    const { handled } = z.object({ handled: z.boolean() }).parse(req.body || {});
    const row = await loadRequest(req, res);
    if (!row) return;
    row.handledAt = handled ? row.handledAt || new Date() : null;
    row.handledBy = handled ? row.handledBy || req.user._id : null;
    await row.save();
    res.json({ request: shapeRequest(row.toObject()) });
  } catch (err) {
    next(err);
  }
});

// A person asking us to delete what they sent (Privacy Policy, "Demo requests"). Gone for good — the
// only copy left is the notice email in the inbox.
router.delete('/demo-requests/:id', async (req, res, next) => {
  try {
    const row = await loadRequest(req, res);
    if (!row) return;
    await row.deleteOne();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

const visitsSchema = z.object({ days: z.coerce.number().int().min(1).max(366).default(60) });

// Visits per day for the last `days` days (today included), each split by page and by source. Days
// with no visits come back as zeros, so the chart has no gaps.
router.get('/visits', async (req, res, next) => {
  try {
    const { days } = visitsSchema.parse(req.query);
    // Whole calendar days back from today's date in the owner's zone — stepping back 24 hours at a
    // time would repeat or skip a day across a daylight-saving change.
    const [y, m, d] = visitDay().split('-').map(Number);
    const dayList = [];
    for (let i = days - 1; i >= 0; i -= 1) dayList.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
    const rows = await SiteVisitDay.aggregate([
      { $match: { day: { $gte: dayList[0], $lte: dayList[dayList.length - 1] } } },
      // Two racing first visits can split one key across two rows (see the model) — sum them back.
      { $group: { _id: { day: '$day', path: '$path', source: '$source' }, count: { $sum: '$count' } } },
    ]);
    const byDay = new Map(dayList.map((d) => [d, { day: d, total: 0, byPath: {}, bySource: {} }]));
    const sourceTotals = {};
    for (const { _id: k, count } of rows) {
      const d = byDay.get(k.day);
      if (!d) continue;
      d.total += count;
      d.byPath[k.path] = (d.byPath[k.path] || 0) + count;
      d.bySource[k.source] = (d.bySource[k.source] || 0) + count;
      sourceTotals[k.source] = (sourceTotals[k.source] || 0) + count;
    }
    const sources = Object.entries(sourceTotals).sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count }));
    res.json({ days: [...byDay.values()], sources });
  } catch (err) {
    next(err);
  }
});

export default router;
