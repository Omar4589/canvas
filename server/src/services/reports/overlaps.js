import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Household } from '../../models/Household.js';
import { User } from '../../models/User.js';
import { Pass } from '../../models/Pass.js';
import { KNOCK_ACTIONS } from './aggregations.js';

// Overlap detection (shared by GET /admin/reports/overlaps and the canvasser timeline).
// A house is an "overlap" only when 2+ DISTINCT canvassers knocked it within the SAME pass.
// Once a house is knocked in a pass nobody should return until the next pass, so a single
// canvasser revisiting — or different canvassers across DIFFERENT passes (a legitimate 2nd-pass
// sweep of not-homes/undecideds) — is not an overlap. passId:null is its own bucket (legacy
// data: 2+ distinct canvassers there still collide).
//
// `match` is a fully-built CanvassActivity filter (org/campaign/effort + date window); this
// adds the KNOCK_ACTIONS clause itself. Returns one card per household (the shape the route
// has always returned) plus UNCAPPED `total`/`householdIds`/`overlapUserIds` — the card list
// truncates at `limit` (the worst collisions first), but reconciliation counts and the
// per-canvasser inOverlap flags must not silently degrade on long date ranges.
// Overlap SET for the map / household-panel indicator — the households where 2+ distinct
// canvassers knocked the same (household, pass). Unlike computeOverlaps this does NOT $push
// every event, so one pass over the campaign answers both questions below.
//
// DATE SCOPING is ANCHORED, not windowed (owner decision 2026-07-19). The driving scenario: a door
// is knocked 4/5 in pass 1, then a different canvasser knocks it again 4/11. Viewing 4/11, the
// admin MUST get the alert — that is the whole point of the indicator. So:
//   • DETECT the collision across the WHOLE pass (2+ distinct canvassers on one household+pass).
//   • SURFACE it when AT LEAST ONE of its knocks lands inside the chosen dates.
// A plain windowed $match cannot do this: on 4/11 it sees one lone knock, finds no collision, and
// stays silent — exactly the miss the date-scoped /overlaps below suffers from. Hence the date test
// is an EXPRESSION inside $group, never a $match. The rendered detail lists EVERY canvasser in the
// pass (including the 4/5 one), so the admin reads "today's knock hit a door X already did".
// Collisions with NO knock in the window are still real but purely historical — they come back as
// `outOfRangeTotal` for the map's "N more outside your dates" hint.
//
// `match` = org/campaign/effort (+passId?) and must NOT carry a date range.
// `userId` filters to collisions INVOLVING that canvasser — deliberately applied after grouping,
// never as a $match: narrowing the rows to one canvasser first would leave every group with a
// single distinct canvasser, so nothing could ever collide and the layer would read empty.
export async function computeOverlapDoors(match, { dateRange = null, userId = null } = {}) {
  const from = dateRange?.from || null;
  const to = dateRange?.to || null;
  const rangeConds = [];
  if (from) rangeConds.push({ $gte: ['$timestamp', from] });
  if (to) rangeConds.push({ $lt: ['$timestamp', to] }); // parseDateRange's upper bound is exclusive
  const inRangeExpr = rangeConds.length ? { $and: rangeConds } : true;

  // One row per (household, pass, canvasser) — NOT per event. That is the whole trick: it carries
  // each canvasser's latest knock and whether they knocked in-window, at a cost bounded by distinct
  // triples rather than by knock volume, so this stays safe to run across an entire pass.
  const rows = await CanvassActivity.aggregate([
    { $match: { ...match, actionType: { $in: KNOCK_ACTIONS } } },
    {
      $group: {
        _id: { householdId: '$householdId', passId: '$passId', userId: '$userId' },
        lastAt: { $max: '$timestamp' },
        inRangeKnocks: { $sum: { $cond: [inRangeExpr, 1, 0] } },
      },
    },
  ]);
  if (!rows.length) return { householdIds: [], doors: [], total: 0, outOfRangeTotal: 0 };

  // Regroup into (household, pass) → its canvassers. A collision is 2+ distinct canvassers in the
  // pass; it is SURFACED when at least one knock — anyone's — landed in the window.
  const groups = new Map();
  for (const r of rows) {
    const key = `${r._id.householdId}|${r._id.passId || ''}`;
    if (!groups.has(key)) {
      groups.set(key, { householdId: r._id.householdId, passId: r._id.passId || null, canvassers: [] });
    }
    groups.get(key).canvassers.push({
      userId: String(r._id.userId),
      lastAt: r.lastAt,
      inRange: r.inRangeKnocks > 0,
    });
  }

  const wanted = userId ? String(userId) : null;
  const surfaced = [];
  const outOfRangeHouseholds = new Set();
  for (const g of groups.values()) {
    if (g.canvassers.length < 2) continue; // no collision in this pass at all
    if (wanted && !g.canvassers.some((c) => c.userId === wanted)) continue; // not this canvasser's
    if (g.canvassers.some((c) => c.inRange)) surfaced.push(g);
    else outOfRangeHouseholds.add(String(g.householdId)); // real, but entirely before/after the window
  }

  const passIds = [...new Set(surfaced.map((g) => g.passId).filter(Boolean).map(String))];
  const userIds = [...new Set(surfaced.flatMap((g) => g.canvassers.map((c) => c.userId)))];
  const [users, passes] = await Promise.all([
    userIds.length ? User.find({ _id: { $in: userIds } }, 'firstName lastName').lean() : [],
    passIds.length ? Pass.find({ _id: { $in: passIds } }, 'roundNumber name').lean() : [],
  ]);
  const uMap = new Map(users.map((u) => [String(u._id), `${u.firstName || ''} ${u.lastName || ''}`.trim()]));
  const pMap = new Map(passes.map((p) => [String(p._id), p]));

  const byHousehold = new Map();
  for (const g of surfaced) {
    const hid = String(g.householdId);
    if (!byHousehold.has(hid)) byHousehold.set(hid, { householdId: hid, passes: [] });
    const pass = g.passId ? pMap.get(String(g.passId)) : null;
    byHousehold.get(hid).passes.push({
      passId: g.passId ? String(g.passId) : null,
      roundLabel: pass ? `Pass ${pass.roundNumber} · ${pass.name}` : 'Legacy / no pass',
      // Newest first so "who hit it most recently" reads off the top. `inRange` lets the UI mark
      // which knock is the one you're looking at vs the earlier one that made it a collision.
      canvassers: g.canvassers
        .slice()
        .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt))
        .map((c) => ({ userId: c.userId, name: uMap.get(c.userId) || 'Unknown', lastAt: c.lastAt, inRange: c.inRange })),
    });
  }
  const doors = [...byHousehold.values()];
  // Only doors the window does NOT already ring count as "more outside your dates" — a door with
  // one in-range collision and another out-of-range one is already on screen.
  for (const d of doors) outOfRangeHouseholds.delete(d.householdId);
  return {
    householdIds: doors.map((d) => d.householdId),
    doors,
    total: doors.length,
    outOfRangeTotal: outOfRangeHouseholds.size,
  };
}

export async function computeOverlaps(match, { organizationId, limit = 200 } = {}) {
  const [facets] = await CanvassActivity.aggregate([
    { $match: { ...match, actionType: { $in: KNOCK_ACTIONS } } },
    {
      $group: {
        _id: { householdId: '$householdId', passId: '$passId' },
        canvassers: { $addToSet: '$userId' },
        events: {
          $push: { userId: '$userId', actionType: '$actionType', timestamp: '$timestamp' },
        },
      },
    },
    { $set: { distinctCount: { $size: '$canvassers' } } },
    { $match: { distinctCount: { $gt: 1 } } },
    {
      $facet: {
        cards: [{ $sort: { distinctCount: -1 } }, { $limit: limit }],
        all: [
          {
            $group: {
              _id: null,
              householdIds: { $addToSet: '$_id.householdId' },
              userIdSets: { $addToSet: '$canvassers' },
            },
          },
        ],
      },
    },
  ]);

  const collisions = facets?.cards || [];
  const allSummary = facets?.all?.[0] || null;
  const allHouseholdIds = (allSummary?.householdIds || []).map(String);
  const overlapUserIds = [...new Set((allSummary?.userIdSets || []).flat().map(String))];

  if (!collisions.length) {
    return { overlaps: [], total: 0, householdIds: [], overlapUserIds: [] };
  }

  const householdIds = [...new Set(collisions.map((c) => String(c._id.householdId)))];
  const passIds = [...new Set(collisions.map((c) => c._id.passId).filter(Boolean).map(String))];
  const userIds = [...new Set(collisions.flatMap((c) => c.events.map((e) => String(e.userId))))];

  const [households, users, passes] = await Promise.all([
    Household.find(
      { _id: { $in: householdIds }, organizationId },
      'addressLine1 addressLine2 city state zipCode location'
    ).lean(),
    User.find({ _id: { $in: userIds } }, 'firstName lastName email').lean(),
    passIds.length ? Pass.find({ _id: { $in: passIds } }, 'roundNumber name').lean() : [],
  ]);

  const hMap = new Map(households.map((h) => [String(h._id), h]));
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  const pMap = new Map(passes.map((p) => [String(p._id), p]));

  // Roll the (household, pass) collisions up into one card per household, listing each
  // colliding pass and the canvassers who knocked that door in it.
  const byHousehold = new Map();
  for (const c of collisions) {
    const h = hMap.get(String(c._id.householdId));
    if (!h) continue;
    const hid = String(c._id.householdId);
    if (!byHousehold.has(hid)) {
      byHousehold.set(hid, {
        household: {
          id: hid,
          addressLine1: h.addressLine1,
          addressLine2: h.addressLine2 || null,
          city: h.city,
          state: h.state,
          zipCode: h.zipCode,
        },
        passes: [],
        canvasserSet: new Set(),
      });
    }
    const entry = byHousehold.get(hid);
    const pass = c._id.passId ? pMap.get(String(c._id.passId)) : null;
    const roundNumber = pass?.roundNumber ?? null;
    entry.passes.push({
      passId: c._id.passId ? String(c._id.passId) : null,
      roundNumber,
      roundLabel: pass ? `Pass ${pass.roundNumber} · ${pass.name}` : 'Legacy / no pass',
      canvassers: c.events
        .map((e) => {
          const u = uMap.get(String(e.userId));
          return {
            userId: String(e.userId),
            firstName: u?.firstName || '',
            lastName: u?.lastName || '',
            email: u?.email || '',
            actionType: e.actionType,
            timestamp: e.timestamp,
          };
        })
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    });
    for (const e of c.events) entry.canvasserSet.add(String(e.userId));
  }

  const result = [...byHousehold.values()]
    .map((e) => ({
      household: e.household,
      passes: e.passes.sort((a, b) => (a.roundNumber ?? Infinity) - (b.roundNumber ?? Infinity)),
      totalCanvassers: e.canvasserSet.size,
    }))
    .sort((a, b) => b.totalCanvassers - a.totalCanvassers);

  return {
    overlaps: result,
    // True (pre-cap) counts: `total` = every overlapping household in the window, even
    // when only the first `limit` cards are returned.
    total: allHouseholdIds.length,
    householdIds: allHouseholdIds,
    overlapUserIds,
  };
}
