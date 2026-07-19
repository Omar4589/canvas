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
// Pass-wide overlap SET — the households (with their colliding pass + canvassers) where 2+
// distinct canvassers knocked the same (household, pass). Unlike computeOverlaps this does
// NOT $push every event, so it is cheap enough to run WITHOUT a date window over a whole
// campaign — and it MUST run un-windowed: a same-pass overlap is a fact about the pass, not
// a calendar range, so two knocks days apart in one pass still collide. (computeOverlaps'
// callers are date-scoped, which silently hides exactly those cross-day collisions.) Powers
// the map / household-panel audit indicator. `match` = org/campaign/effort (+passId?) — do
// NOT pass a date range.
export async function computeOverlapDoors(match, { organizationId } = {}) {
  const rows = await CanvassActivity.aggregate([
    { $match: { ...match, actionType: { $in: KNOCK_ACTIONS } } },
    { $group: { _id: { householdId: '$householdId', passId: '$passId' }, canvassers: { $addToSet: '$userId' } } },
    { $match: { 'canvassers.1': { $exists: true } } }, // 2+ distinct canvassers
  ]);
  if (!rows.length) return { householdIds: [], doors: [], total: 0 };

  const passIds = [...new Set(rows.map((r) => r._id.passId).filter(Boolean).map(String))];
  const userIds = [...new Set(rows.flatMap((r) => r.canvassers.map(String)))];
  const [users, passes] = await Promise.all([
    User.find({ _id: { $in: userIds } }, 'firstName lastName').lean(),
    passIds.length ? Pass.find({ _id: { $in: passIds } }, 'roundNumber name').lean() : [],
  ]);
  const uMap = new Map(users.map((u) => [String(u._id), `${u.firstName || ''} ${u.lastName || ''}`.trim()]));
  const pMap = new Map(passes.map((p) => [String(p._id), p]));

  const byHousehold = new Map();
  for (const r of rows) {
    const hid = String(r._id.householdId);
    if (!byHousehold.has(hid)) byHousehold.set(hid, { householdId: hid, passes: [] });
    const pass = r._id.passId ? pMap.get(String(r._id.passId)) : null;
    byHousehold.get(hid).passes.push({
      passId: r._id.passId ? String(r._id.passId) : null,
      roundLabel: pass ? `Pass ${pass.roundNumber} · ${pass.name}` : 'Legacy / no pass',
      canvassers: r.canvassers.map((u) => ({ userId: String(u), name: uMap.get(String(u)) || 'Unknown' })),
    });
  }
  const doors = [...byHousehold.values()];
  return { householdIds: doors.map((d) => d.householdId), doors, total: doors.length };
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
