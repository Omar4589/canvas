import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { DemoRequest } from '../../models/DemoRequest.js';
import { SiteVisitDay } from '../../models/SiteVisitDay.js';
import { SiteVisitHour } from '../../models/SiteVisitHour.js';
import { visitDay, visitHour, channelOf, CHANNELS, APP_PAGE } from '../../services/site/siteVisits.js';

// The public website, seen from the inside: /super-admin/website. Two things the marketing site
// produces and nothing else in the product does —
//   · demo requests (models/DemoRequest.js): every submission of the site's one form, saved before
//     its notice email so a failed send can't lose it; mark one handled, or delete it when the person
//     asks (Privacy Policy, "Demo requests"; it also expires on its own after 24 months);
//   · visit counts (models/SiteVisitDay.js, models/SiteVisitHour.js): page loads of the public pages by
//     day, page and source, and by hour and kind of device, with no personal information in them.
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
  phone: r.phone || null,
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

const trafficSchema = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) });

// YYYY-MM-DD `n` calendar days before `day`. Whole calendar days in the owner's zone — stepping back 24
// hours at a time would repeat or skip a day across a daylight-saving change.
const daysBefore = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};

const blankDay = (day) => ({
  day,
  visits: 0,
  channels: Object.fromEntries(CHANNELS.map((c) => [c, 0])),
  moves: 0,
  appPage: 0,
  devices: { phone: 0, tablet: 0, computer: 0 },
  hours: Array(24).fill(0),
  demoRequests: 0,
});

const bump = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);
// Biggest first; a tie goes alphabetically, with "didn't say" (null) after the rest.
const ranked = (map, name) =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] === null) - (b[0] === null) || String(a[0]).localeCompare(String(b[0])))
    .map(([k, count]) => ({ [name]: k, count }));

// Everything the Website page's Traffic tab shows, for the last `days` days (today included):
//   · days — oldest first, zeros included. `visits` counts arrivals on the marketing pages (a move between
//     our own pages is not one; the canvasser app page is its own `appPage` line), split by channel; the
//     hour and device split comes from SiteVisitHour, kept only from `hoursSince` on;
//   · today — the hour now, and yesterday and the same day last week, each with what it had by this time
//     of day (null where that day's hours weren't all counted) — read from 8 days whatever the range;
//   · sources, pages, movesTo — the range's referring sites and tags, landing pages, and moves by page;
//   · demoRequests — the range's requests by what they answered, where they were sent from and the link's
//     tag. (How many are open is GET /demo-requests' `open`.)
router.get('/traffic', async (req, res, next) => {
  try {
    const { days } = trafficSchema.parse(req.query);
    const now = new Date();
    const today = visitDay(now);
    const hour = visitHour(now);
    const span = Math.max(days, 8);
    const dayList = [];
    for (let i = span - 1; i >= 0; i -= 1) dayList.push(daysBefore(today, i));
    const first = dayList[0];
    const rangeFirst = daysBefore(today, days - 1);
    const [y, m, d] = first.split('-').map(Number);
    const [visitRows, hourRows, requests, earliestHour] = await Promise.all([
      // Two racing first visits can split one key across two rows (see the models) — sum them back.
      SiteVisitDay.aggregate([
        { $match: { day: { $gte: first, $lte: today } } },
        { $group: { _id: { day: '$day', path: '$path', source: '$source' }, count: { $sum: '$count' } } },
      ]),
      SiteVisitHour.aggregate([
        { $match: { day: { $gte: first, $lte: today } } },
        { $group: { _id: { day: '$day', hour: '$hour', device: '$device' }, count: { $sum: '$count' } } },
      ]),
      // A day early in UTC, so no request on the first Central day is missed; visitDay() files each one.
      DemoRequest.find({ createdAt: { $gte: new Date(Date.UTC(y, m - 1, d - 1)) } })
        .select('createdAt heardAbout page source')
        .lean(),
      SiteVisitHour.findOne({}).sort({ day: 1 }).select('day').lean(),
    ]);

    const byDay = new Map(dayList.map((x) => [x, blankDay(x)]));
    const sources = new Map();
    const pages = new Map();
    const movesTo = new Map();
    for (const { _id: k, count } of visitRows) {
      const row = byDay.get(k.day);
      if (!row) continue;
      const channel = channelOf(k.source);
      const inRange = k.day >= rangeFirst;
      if (!channel) {
        row.moves += count;
        if (inRange) bump(movesTo, k.path, count);
      } else if (k.path === APP_PAGE) {
        row.appPage += count;
      } else {
        row.visits += count;
        row.channels[channel] += count;
        if (inRange) {
          bump(pages, k.path, count);
          if (channel !== 'direct') bump(sources, k.source, count);
        }
      }
    }
    for (const { _id: k, count } of hourRows) {
      const row = byDay.get(k.day);
      if (!row || !(k.hour >= 0 && k.hour < 24)) continue;
      row.hours[k.hour] += count;
      if (k.device in row.devices) row.devices[k.device] += count;
    }

    const heardAbout = new Map();
    const sentFrom = new Map();
    const tags = new Map();
    let total = 0;
    for (const r of requests) {
      const day = visitDay(r.createdAt);
      const row = byDay.get(day);
      if (!row) continue;
      row.demoRequests += 1;
      if (day < rangeFirst) continue;
      total += 1;
      bump(heardAbout, r.heardAbout || null);
      bump(sentFrom, r.page || null);
      // /aapc files an untagged request as "aapc" (DemoRequest.jsx) — that is the page, not a link's tag.
      if (r.source && !(r.source === 'aapc' && r.page === '/aapc')) bump(tags, r.source);
    }

    // A day's hours are complete only after the first day they were counted (it started mid-day).
    const hoursSince = earliestHour?.day || null;
    // "By this time": the earlier day's whole hours before this one, plus its share of this hour by the minute —
    // visits are counted by the hour, so that share is spread evenly. The owner's zone is a whole number of
    // hours from UTC, so its minutes are UTC's.
    const intoHour = (now.getUTCMinutes() * 60 + now.getUTCSeconds()) / 3600;
    const compare = (day) => {
      const row = byDay.get(day);
      if (!(hoursSince && day > hoursSince)) return { day, visits: row.visits, byNow: null };
      const before = row.hours.slice(0, hour).reduce((a, b) => a + b, 0);
      return { day, visits: row.visits, byNow: before + Math.round(row.hours[hour] * intoHour) };
    };

    res.json({
      today: { day: today, hour, yesterday: compare(daysBefore(today, 1)), lastWeek: compare(daysBefore(today, 7)) },
      hoursSince,
      days: dayList.slice(-days).map((x) => byDay.get(x)),
      sources: ranked(sources, 'source').slice(0, 25).map((s) => ({ ...s, channel: channelOf(s.source) })),
      pages: ranked(pages, 'path'),
      movesTo: ranked(movesTo, 'path'),
      demoRequests: {
        total,
        heardAbout: ranked(heardAbout, 'answer'),
        pages: ranked(sentFrom, 'page'),
        tags: ranked(tags, 'source'),
      },
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

export default router;
