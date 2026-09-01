import mongoose from 'mongoose';
import { zonedDayRange } from '../../utils/timezone.js';

// The ONE owner of "what counts as a note, and which ones does this filter select".
//
// Two consumers read it and must never drift: the view-only Notes hub
// (GET /admin/reports/notes) and the `notes` export type (exportBuilders/exportEstimates).
// Same precedent as services/reports/knocksByPass.js, which reports and the backup both ride.
//
// The three live note stores. (A FOURTH, SurveyResponseArchive.note, holds the note of an
// overwritten survey and is deliberately NOT read here — the hub and the export both describe
// themselves as the notes CURRENTLY on the campaign.)
export const NOTE_SOURCES = ['door', 'survey', 'voter'];

// CanvassActivity.actionType enum, mirrored. Canonical HERE rather than in
// services/export/exportTypes.js, which needs it too: exportTypes -> exportBuilders ->
// notesQuery, so the export registry can import this but never the other way around.
export const ACTION_TYPES = [
  'not_home',
  'wrong_address',
  'refused',
  'survey_submitted',
  'note_added',
  'lit_dropped',
  'restricted',
  'no_soliciting',
];

export const NOTE_NONEMPTY = { $exists: true, $ne: null, $not: /^\s*$/ };

// Escape user text so a search term can't inject regex metacharacters into a $regex.
export const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const oid = (v) => new mongoose.Types.ObjectId(String(v));

// Normalize a request's or an export job's params into ONE cast, timezone-resolved scope.
//
// Takes an explicit contract rather than raw params, for three reasons that each cost a bug:
//  - the day window resolves in the campaign's ANCHOR timezone, which lives on req.anchorTz /
//    ctx.anchorTz and is in no params object;
//  - exportTypes' normalizeCommon stringifies every id, and aggregation $match does NO Mongoose
//    casting, so a string id silently matches nothing in adminNotesPipeline;
//  - passId carries the string sentinel 'legacy' (normalizeCommon whitelists it; the Exports page
//    renders it as "Legacy / no pass"), and casting that to an ObjectId throws a BSON error.
export const resolveNoteScope = ({
  organizationId,
  campaignId,
  anchorTz,
  from = null,
  to = null,
  effortId,
  passId,
  userId,
  q,
  sources,
  actionTypes,
} = {}) => {
  const range = zonedDayRange(from ? String(from).slice(0, 10) : null, to ? String(to).slice(0, 10) : null, anchorTz || 'UTC');
  const hasRange = !!(range.$gte || range.$lt);

  const term = typeof q === 'string' ? q.trim() : '';
  const rx = term ? new RegExp(escapeRegExp(term), 'i') : null;

  // An empty selection means "no filter", never "match nothing" — an empty $in/$or would
  // otherwise reach Mongo (an empty $or is an error).
  const picked = (list, allowed) => {
    if (!Array.isArray(list)) return null;
    const kept = list.filter((v) => allowed.includes(v));
    return kept.length ? kept : null;
  };

  const scope = {
    organizationId: oid(organizationId),
    campaignId: oid(campaignId),
    range: hasRange ? range : null,
    noteClause: rx ? { ...NOTE_NONEMPTY, $regex: rx } : NOTE_NONEMPTY,
    bodyClause: rx ? { $exists: true, $ne: null, $regex: rx } : { $exists: true, $ne: null },
    userId: userId ? oid(userId) : null,
    effortId: effortId ? oid(effortId) : null,
    actionTypes: picked(actionTypes, ACTION_TYPES),
  };

  // undefined = not filtering by round; null = the pre-turf bucket, which is a REAL match value.
  if (passId === 'legacy') scope.passId = null;
  else if (passId) scope.passId = oid(passId);
  else scope.passId = undefined;

  // TWO source sets, deliberately. `sources` honors the caller's source picker and is what to
  // FETCH; `availableSources` applies only the structural exclusions below, ignoring the picker,
  // and is what to COUNT — the Notes hub's chip counts must stay accurate for a source that is
  // currently unticked, while still honoring every other filter.
  scope.availableSources = resolveSources(scope, null);
  scope.sources = resolveSources(scope, picked(sources, NOTE_SOURCES));
  return scope;
};

// Which sources a given filter set can honestly return.
//
// VoterNote is org-level: it has no effort, no pass, and no actionType, so any filter on those
// three would silently return zero admin notes. Excluding them explicitly is what lets both
// surfaces SAY so ("Admin notes aren't tied to a walk list…") instead of looking broken.
const resolveSources = (scope, wanted) => {
  const want = (t) => !wanted || wanted.includes(t);
  const out = [];
  if (want('door')) out.push('door');
  // A survey row's actionType is always 'survey_submitted'.
  if (want('survey') && (!scope.actionTypes || scope.actionTypes.includes('survey_submitted'))) {
    out.push('survey');
  }
  if (
    want('voter') &&
    !scope.effortId &&
    scope.passId === undefined &&
    !scope.actionTypes
  ) {
    out.push('voter');
  }
  return out;
};

const campaignBase = (scope) => {
  const q = { organizationId: scope.organizationId, campaignId: scope.campaignId };
  if (scope.effortId) q.effortId = scope.effortId;
  if (scope.passId !== undefined) q.passId = scope.passId;
  if (scope.userId) q.userId = scope.userId;
  return q;
};

// Door notes — CanvassActivity.note.
//
// The actionType clause is written ONCE, as $or branches, because three rules land on the same key:
//
//  1. DEDUP. A field survey writes the same note text to BOTH ledgers (routes/mobile/canvass.js
//     sets `note` on the survey_submitted CanvassActivity row AND on the SurveyResponse), so an
//     ordinary survey_submitted row must be excluded here or every field survey note appears twice.
//
//  2. THE CONVERTED-DOOR EXEMPTION. services/canvass/surveyConversion.js rewrites an existing door
//     row IN PLACE — actionType becomes 'survey_submitted', reclassified.kind becomes 'to_survey' —
//     and never touches `note`. So the canvasser's original door note survives on a row rule 1 would
//     discard, while the SurveyResponse that run creates carries the ADMIN's conversion note. Two
//     different notes: without this branch the canvasser's is lost from every source.
//
//  3. THE OUTCOME FILTER. A converted row's actionType now reads 'survey_submitted', so it is
//     reachable under "Surveyed" and not under its pre-conversion outcome — which is exactly what
//     the row, the CSV Outcome cell and the Notes page all display, so the filter and the label
//     agree. (Matching on reclassified.from instead is implementable, but then the Outcome cell must
//     print "Surveyed (was Not home)" — never change one without the other.)
export const doorNotesMatch = (scope) => {
  const q = { ...campaignBase(scope), note: scope.noteClause };
  if (scope.range) q.timestamp = scope.range;

  const converted = { actionType: 'survey_submitted', 'reclassified.kind': 'to_survey' };
  const sel = scope.actionTypes;
  const doorTypes = sel ? sel.filter((t) => t !== 'survey_submitted') : null;
  const branches = sel
    ? [
        ...(doorTypes.length ? [{ actionType: { $in: doorTypes } }] : []),
        ...(sel.includes('survey_submitted') ? [converted] : []),
      ]
    : [{ actionType: { $ne: 'survey_submitted' } }, converted];

  // Composed through $and so a later clause can never clobber it, and never emitted empty
  // (resolveNoteScope normalizes an empty selection to null, so `sel` always has a member).
  q.$and = [...(q.$and || []), { $or: branches }];
  return q;
};

// Survey notes — SurveyResponse.note.
export const surveyNotesMatch = (scope) => {
  const q = { ...campaignBase(scope), note: scope.noteClause };
  if (scope.range) q.submittedAt = scope.range;
  return q;
};

// Admin/profile notes — VoterNote.body. Org-level, so the campaign scope is the voter -> household
// join; the non-preserving $unwind pair IS the scoping (a note whose voter's household is not in
// this campaign drops out). Returns the household address + voter name so callers need no second
// lookup for those.
export const adminNotesMatch = (scope) => {
  const q = { organizationId: scope.organizationId, body: scope.bodyClause };
  if (scope.range) q.createdAt = scope.range;
  if (scope.userId) q.authorId = scope.userId;
  return q;
};

export const adminNotesPipeline = (scope) => [
  { $match: adminNotesMatch(scope) },
  {
    $lookup: {
      from: 'voters',
      localField: 'voterId',
      foreignField: '_id',
      pipeline: [
        { $match: { organizationId: scope.organizationId } },
        {
          $lookup: {
            from: 'households',
            localField: 'householdId',
            foreignField: '_id',
            pipeline: [
              { $match: { campaignId: scope.campaignId } },
              { $project: { addressLine1: 1, addressLine2: 1, city: 1, state: 1, zipCode: 1 } },
            ],
            as: 'hh',
          },
        },
        { $unwind: '$hh' },
        { $project: { fullName: 1, hh: 1 } },
      ],
      as: 'v',
    },
  },
  { $unwind: '$v' },
];
