import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { Pass } from '../../models/Pass.js';
import { Effort } from '../../models/Effort.js';
import { Campaign } from '../../models/Campaign.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { User } from '../../models/User.js';
import { knocksPipeline, billableDoorsOf, connectionRate, contactRate, withTeam } from './aggregations.js';
import { billRestrictedFor } from './billRestricted.js';
import { outcomeInUse } from '../canvass/outcomeToggles.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

// One pass, broken down by book — the campaign Home's By book table and its CSV (routes/admin/reports.js
// → /knocks-by-book). It is the By pass row of that pass split by book: the same knocksPipeline over the
// same match (org, campaign, the walk list when one is picked, the pass, the date window, the crew clause)
// with `byBook`, so the book rows, the "not in a book" row and the totals add up — and the totals equal
// that pass's row in services/reports/knocksByPass.js for the same filters, by construction. The walk list
// goes in the match exactly as By pass puts it there, and the route builds the crew clause from the same
// scope, so "No coordinator" leaves out the same leads both ways.
//
//   · A knock belongs to the book it was recorded in (CanvassActivity.turfId, stamped when it was saved —
//     services/canvass/attribution.js). A door moved between books mid-pass counts once, in the book its
//     latest knock carries (knocksPipeline's byBook).
//   · Surveys taken come from the response ledger by ITS turfId (a bare count: one row is one form), with
//     the same window on submittedAt — the clock the By pass table reads for the same column.
//   · Doors = the doors in the book now (Turf.householdIds, counted in the database). Not windowed, not
//     crew-scoped: doors belong to a book, not to a crew. Knocks follow the book they were recorded in, so
//     once doors move between books a book can hold more knocks than doors (the table then shows no
//     share). Turf Cutting's and the phone's progress count only the doors still eligible to knock.
//   · Canvassers = who is assigned to the book now (TurfAssignment), by name. The table's audience (an org
//     admin, or a lead who manages the campaign) already sees them on Turf Cutting.
//   · Row set = every live book of the pass (0-knock books are information) and one "not in a book" row
//     for knocks and surveys whose book is none of them (recorded with no book, or in a book since merged
//     away or deleted), present only when it holds something.
export async function buildKnocksByBookData({ organizationId, campaignId, passId, effortId = null, timestampRange = null, team = null }) {
  const orgId = oid(organizationId);
  const cId = oid(campaignId);
  const pId = oid(passId);
  const pass = await Pass.findOne({ _id: pId, organizationId: orgId, campaignId: cId }, 'roundNumber name status effortId').lean();
  if (!pass) return { error: { status: 404, message: 'Pass not found' } };

  const scope = { organizationId: orgId, campaignId: cId, passId: pId };
  // The walk list, when the page has one picked: effortId is stamped on both ledgers, as By pass reads it.
  const counted = effortId ? { ...scope, effortId: oid(effortId) } : scope;
  const match = withTeam({ ...counted, ...(timestampRange ? { timestamp: timestampRange } : {}) }, team);
  const surveyMatch = withTeam({ ...counted, ...(timestampRange ? { submittedAt: timestampRange } : {}) }, team);
  const knockOpts = { includeRestricted: true };

  const [billRestricted, campaignDoc, effort, perBook, totalRows, surveysPerBook, turfs] = await Promise.all([
    billRestrictedFor(orgId, cId),
    Campaign.findOne({ _id: cId, organizationId: orgId }, { type: 1, enabledOutcomes: 1, everEnabledOutcomes: 1 }).lean(),
    Effort.findOne({ _id: pass.effortId, organizationId: orgId }, 'name').lean(),
    CanvassActivity.aggregate(knocksPipeline(match, { ...knockOpts, byBook: true })),
    CanvassActivity.aggregate(knocksPipeline(match, knockOpts)),
    SurveyResponse.aggregate([{ $match: surveyMatch }, { $group: { _id: '$turfId', surveysTaken: { $sum: 1 } } }]),
    // Archived books are merge-absorbed stubs — their doors live in the book that absorbed them. The doors
    // are counted here rather than shipped: a big pass has hundreds of books of a thousand doors each.
    Turf.aggregate([
      { $match: { ...scope, status: { $ne: 'archived' } } },
      { $project: { name: 1, status: 1, doors: { $size: { $ifNull: ['$householdIds', []] } } } },
    ]),
  ]);

  const assignments = turfs.length
    ? await TurfAssignment.find({ organizationId: orgId, turfId: { $in: turfs.map((t) => t._id) } }, 'turfId userId').lean()
    : [];
  const users = assignments.length
    ? await User.find({ _id: { $in: [...new Set(assignments.map((a) => String(a.userId)))] } }, 'firstName lastName').lean()
    : [];
  const nameOf = new Map(users.map((u) => [String(u._id), [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unnamed']));
  const canvassersOf = new Map();
  for (const a of assignments) {
    const name = nameOf.get(String(a.userId));
    if (!name) continue;
    const key = String(a.turfId);
    canvassersOf.set(key, [...(canvassersOf.get(key) || []), name]);
  }

  const bookIds = new Set(turfs.map((t) => String(t._id)));
  const countsOf = new Map(perBook.map((r) => [String(r._id), r]));
  const surveysOf = new Map(surveysPerBook.map((r) => [String(r._id), r.surveysTaken]));
  const ZERO = {
    knocks: 0, surveyedKnocks: 0, litKnocks: 0, refusedKnocks: 0, noSolicitingKnocks: 0, notTargetKnocks: 0,
    contactKnocks: 0, billableDoors: 0, restrictedDoors: 0,
  };
  const COUNTS = Object.keys(ZERO);
  const shape = (k, surveysTaken) => ({
    knocks: k.knocks,
    surveyedKnocks: k.surveyedKnocks,
    surveysTaken,
    litKnocks: k.litKnocks,
    refusedKnocks: k.refusedKnocks,
    noSolicitingKnocks: k.noSolicitingKnocks,
    notTargetKnocks: k.notTargetKnocks,
    contactKnocks: k.contactKnocks,
    billableDoors: billableDoorsOf(k, billRestricted),
    restrictedDoors: k.restrictedDoors,
    connectionRate: connectionRate(k),
    contactRate: contactRate(k),
  });

  const books = turfs
    .map((t) => ({
      turfId: String(t._id),
      name: t.name,
      status: t.status,
      canvassers: (canvassersOf.get(String(t._id)) || []).sort((a, b) => a.localeCompare(b)),
      doors: t.doors,
      ...shape(countsOf.get(String(t._id)) || ZERO, surveysOf.get(String(t._id)) || 0),
    }))
    // Book 2 before Book 10, as Turf Cutting and the phone list them.
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  // Everything that landed in no live book, folded into one row.
  const other = { ...ZERO };
  let otherSurveys = 0;
  for (const [key, row] of countsOf) if (!bookIds.has(key)) for (const f of COUNTS) other[f] += row[f] || 0;
  for (const [key, n] of surveysOf) if (!bookIds.has(key)) otherSurveys += n;
  // (The pipeline's raw billableDoors is every door it counted, restricted-only ones included.)
  const notInBook = other.billableDoors > 0 || otherSurveys > 0 ? { turfId: null, ...shape(other, otherSurveys) } : null;

  const t = totalRows[0] || ZERO;
  const totals = {
    doors: books.reduce((n, b) => n + b.doors, 0),
    ...shape(t, surveysPerBook.reduce((n, r) => n + r.surveysTaken, 0)),
  };

  return {
    pass: {
      passId: String(pass._id),
      effortId: String(pass.effortId),
      effortName: effort?.name || null,
      roundNumber: pass.roundNumber,
      roundName: pass.name,
      roundLabel: `Pass ${pass.roundNumber} · ${pass.name}`,
      status: pass.status,
    },
    books,
    notInBook,
    totals,
    billRestricted,
    notTargetInUse: outcomeInUse(campaignDoc, 'not_target'),
  };
}
