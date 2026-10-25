import mongoose from 'mongoose';
import { ClientReportSeries } from '../../models/ClientReportSeries.js';
import { ClientReport } from '../../models/ClientReport.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Effort } from '../../models/Effort.js';
import { User } from '../../models/User.js';
import { hydrateCanvassers } from './canvasserIdentity.js';
import { knocksPipeline, crewsMatch, withTeam, NOT_BULK } from './aggregations.js';
import { opaqueKey } from './reportVisibility.js';

// Report series (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F4, as amended by §O4). A series is one
// run of reports — the whole campaign, a walk list, a team, or a team on one walk list — and the
// client's tabs follow it. One client per campaign (owner ruling 10-23), but a campaign can have a
// volunteer team and a paid team, and one team name can cover several crews (10-24).
//
// Uniqueness lives in the five partial-unique indexes on the model, not in reads here: every create
// is an upsert or an insert that the index refuses, and a duplicate-key error maps BY INDEX NAME to
// a 409 the builder can explain (TEAM_LABEL_TAKEN, CREW_IN_OTHER_TEAM).

const { ObjectId } = mongoose.Types;

export const SERIES_LABEL_MAX = 60;
export const CAMPAIGN_LABEL = 'Whole campaign';
// Fixed, and what a team typed as "Whole campaign" would collide with — on purpose.
export const CAMPAIGN_LABEL_KEY = 'whole campaign';

export const labelKeyOf = (label) => String(label ?? '').trim().toLowerCase();

const oid = (v) => (v instanceof ObjectId ? v : new ObjectId(String(v)));
const uniqIds = (ids) => [...new Set((ids || []).map(String))].map(oid);
const sortedIdStrings = (ids) => [...new Set((ids || []).map(String))].sort();

/** coordinatorIds ∪ pastCoordinatorIds — what the crew index and Publish's comparison use (§O4). */
export const crewKeysOf = (series) => uniqIds([...(series?.coordinatorIds || []), ...(series?.pastCoordinatorIds || [])]);

/** Two crew sets equal, compared sorted (Publish's coordinator check). */
export const sameCrews = (a, b) => {
  const x = sortedIdStrings(a);
  const y = sortedIdStrings(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

const isDup = (err) => err?.code === 11000 || err?.code === 11001;
const dupIndexName = (err) => {
  const m = /index: (\S+)/.exec(String(err?.message || ''));
  return m ? m[1] : err?.keyPattern ? Object.keys(err.keyPattern).join('_') : '';
};

/** An error the routes turn into a JSON response. */
export class SeriesError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** A duplicate-key error from one of the series indexes, as the 409 the builder can explain. */
export const seriesConflict = async (err, { campaignId, label = null, crewKeys = [] } = {}) => {
  const index = dupIndexName(err);
  if (index.includes('series_label_unique')) {
    const other = await ClientReportSeries.findOne(
      { campaignId, labelKey: labelKeyOf(label), endedAt: null, kind: { $in: ['campaign', 'walk_list', 'team'] } },
      { label: 1 }
    ).lean();
    return new SeriesError(409, 'TEAM_LABEL_TAKEN', 'Another tab on this campaign already has that name — choose a different one.', {
      otherSeriesId: other ? String(other._id) : null,
      otherLabel: other?.label || null,
    });
  }
  if (index.includes('series_crew_unique')) {
    const other = await ClientReportSeries.findOne(
      { campaignId, kind: 'team', endedAt: null, crewKeys: { $in: crewKeys } },
      { label: 1 }
    ).lean();
    return new SeriesError(409, 'CREW_IN_OTHER_TEAM', `A crew you picked is already in ${other?.label ? `"${other.label}"` : 'another team'}.`, {
      otherSeriesId: other ? String(other._id) : null,
      otherLabel: other?.label || null,
    });
  }
  return null;
};

/** Validate an operator-typed label: 1-60 characters after trimming. */
export const cleanLabel = (label) => {
  const s = String(label ?? '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > SERIES_LABEL_MAX) {
    throw new SeriesError(400, 'SERIES_LABEL_INVALID', `A name your client sees must be 1-${SERIES_LABEL_MAX} characters.`);
  }
  return s;
};

// ── The name check (§F4, §O4) ──────────────────────────────────────────────────────────────────

const words = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

// A name's words as written ("McDonald", "José"), each paired with the folded form `words` compares.
const writtenWords = (s) =>
  String(s ?? '')
    .normalize('NFC')
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean)
    .map((raw) => [words(raw)[0], raw]);

/**
 * The names on this campaign a label contains as a WHOLE word of three or more letters: the first
 * or last name of any coordinator or crew member on it. A report name the client reads must never
 * carry a canvasser's name (privacy: "exclude … canvasser identities"). Matched case- and
 * accent-blind, returned as the name is written on the person's record, so the refusal the operator
 * reads says "McDonald", never "mcdonald".
 */
export const namesInLabel = async ({ campaignId, label, extraUserIds = [] }) => {
  const assignments = await CampaignAssignment.find({ campaignId }, { userId: 1, coordinatorId: 1 }).lean();
  const ids = new Set(extraUserIds.map(String));
  for (const a of assignments) {
    ids.add(String(a.userId));
    if (a.coordinatorId) ids.add(String(a.coordinatorId));
  }
  if (!ids.size) return [];
  const users = await User.find({ _id: { $in: [...ids] } }, { firstName: 1, lastName: 1 }).lean();
  const nameWords = new Map(); // folded word → as written (the first spelling seen)
  for (const u of users) {
    for (const [w, raw] of [...writtenWords(u.firstName), ...writtenWords(u.lastName)]) {
      if (w && w.length >= 3 && /^\p{L}+$/u.test(w) && !nameWords.has(w)) nameWords.set(w, raw);
    }
  }
  return [...new Set(words(label).filter((w) => nameWords.has(w)))].map((w) => nameWords.get(w));
};

// ── Finding and creating series ────────────────────────────────────────────────────────────────

const identityFor = ({ campaignId, kind, effortId = null, teamSeriesId = null }) => {
  if (kind === 'campaign') return { campaignId, kind, endedAt: null };
  if (kind === 'walk_list') return { campaignId, kind, effortId, endedAt: null };
  if (kind === 'team_walk_list') return { campaignId, kind, teamSeriesId, effortId, endedAt: null };
  throw new Error(`ensureSeries: ${kind} series are created with createTeamSeries`);
};

// A walk-list series label: the walk list's (frozen) name, " (2)", " (3)"… when another active tab
// of the campaign already reads that way — checked against the active labelKeys here, and retried
// on a duplicate-key error from the label index when two requests race.
const freeWalkListLabel = async (campaignId, base, skip = 0) => {
  const root = String(base || 'Walk list').replace(/\s+/g, ' ').trim().slice(0, SERIES_LABEL_MAX - 5) || 'Walk list';
  const taken = new Set(
    (
      await ClientReportSeries.find(
        { campaignId, endedAt: null, kind: { $in: ['campaign', 'walk_list', 'team'] } },
        { labelKey: 1 }
      ).lean()
    ).map((s) => s.labelKey)
  );
  for (let n = 1; n < 1000; n += 1) {
    const label = n === 1 ? root : `${root} (${n})`;
    if (!taken.has(labelKeyOf(label))) {
      if (skip <= 0) return label;
      skip -= 1;
    }
  }
  throw new Error('freeWalkListLabel: no free label');
};

/**
 * The ONE find-or-create of a campaign, walk-list or team-on-a-walk-list series (§O3): an upsert on
 * the partial index's identity, shared by Create, Next and the migration — so a report created the
 * day after deploy never splits the client's tabs, and the migration never collides with a series a
 * route already made. Stamps that scope's LEGACY reports (no seriesId yet) with the series and a
 * frozen scope as it goes. Returns the series (lean).
 */
export const ensureSeries = async ({
  organizationId,
  campaignId,
  kind,
  effortId = null,
  effortName = null,
  teamSeriesId = null,
  label = null,
  createdBy = null,
}) => {
  const identity = identityFor({ campaignId, kind, effortId, teamSeriesId });
  let series = await ClientReportSeries.findOne(identity).lean();
  for (let attempt = 0; !series && attempt < 8; attempt += 1) {
    let insert;
    if (kind === 'campaign') insert = { label: CAMPAIGN_LABEL, labelKey: CAMPAIGN_LABEL_KEY };
    else if (kind === 'walk_list') {
      const walkLabel = label ? cleanLabel(label) : await freeWalkListLabel(campaignId, effortName, attempt);
      insert = { label: walkLabel, labelKey: labelKeyOf(walkLabel) };
    } else insert = { label: null, labelKey: null };
    try {
      series = await ClientReportSeries.findOneAndUpdate(
        identity,
        {
          $setOnInsert: {
            organizationId,
            ...insert,
            coordinatorIds: [],
            pastCoordinatorIds: [],
            crewKeys: [],
            createdBy,
          },
        },
        { upsert: true, new: true }
      ).lean();
    } catch (err) {
      if (!isDup(err)) throw err;
      // Either another request created this very series (find it), or the label is taken (the next
      // attempt takes the next free suffix). A label the operator typed is never renamed silently.
      series = await ClientReportSeries.findOne(identity).lean();
      if (!series && label && dupIndexName(err).includes('series_label_unique')) {
        throw await seriesConflict(err, { campaignId, label });
      }
    }
  }
  if (!series) throw new Error('ensureSeries: could not create the series');

  // Stamp the scope's legacy reports (made before series existed) — idempotent: only seriesId null.
  if (kind === 'campaign') {
    await ClientReport.updateMany(
      { organizationId, campaignId, seriesId: null, effortId: null },
      { $set: { seriesId: series._id, scope: { kind: 'campaign', label: CAMPAIGN_LABEL } } }
    );
  } else if (kind === 'walk_list') {
    // Each keeps its OWN frozen walk-list name as its scope label (a pipeline: a per-document value).
    await ClientReport.updateMany({ organizationId, campaignId, seriesId: null, effortId }, [
      {
        $set: {
          seriesId: series._id,
          scope: { kind: 'walk_list', label: { $ifNull: ['$effortName', { $literal: series.label }] } },
        },
      },
    ]);
  }
  return series;
};

/** The team a series reads its crews, name and ended state from: itself, or a team-walk-list's parent. */
export const teamOf = async (series) => {
  if (!series) return null;
  if (series.kind === 'team') return series;
  if (series.kind === 'team_walk_list' && series.teamSeriesId) {
    return ClientReportSeries.findById(series.teamSeriesId).lean();
  }
  return null;
};

/** A series' CURRENT label, as the client reads it ("Volunteer team · North" for a team on a walk list). */
export const seriesLabelOf = async (series, { team = undefined, effortName = undefined } = {}) => {
  if (!series) return '';
  if (series.kind !== 'team_walk_list') return series.label || '';
  const parent = team === undefined ? await teamOf(series) : team;
  const name =
    effortName === undefined
      ? (await Effort.findById(series.effortId, { name: 1 }).lean())?.name || 'Walk list'
      : effortName || 'Walk list';
  return `${parent?.label || 'Team'} · ${name}`;
};

/** Ended — or, for a team on a walk list, its parent team ended. */
export const seriesEnded = async (series, team = undefined) => {
  if (!series) return true;
  if (series.endedAt) return true;
  if (series.kind !== 'team_walk_list') return false;
  const parent = team === undefined ? await teamOf(series) : team;
  return !parent || !!parent.endedAt;
};

/** The client's opaque tab key for a series. */
export const seriesKeyForSeries = (series) => opaqueKey(`series:${series._id}`);

// ── Crews ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Coordinators who run a crew on this campaign now (CampaignAssignment rows), with crew sizes. The
 * organization, when known, scopes the read too (SEC-1: never a campaign id alone).
 */
export const runningCrews = async (campaignId, organizationId = null) => {
  const rows = await CampaignAssignment.aggregate([
    { $match: { campaignId: oid(campaignId), ...(organizationId ? { organizationId: oid(organizationId) } : {}), coordinatorId: { $ne: null } } },
    { $group: { _id: '$coordinatorId', members: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.members]));
};

/**
 * Before a recompute or Next of a team report: does every coordinator in the team still run a crew
 * here, and has no past coordinator started running one again (§F4, §O4)? Returns { departed,
 * returned } as id strings — both empty when nothing changed.
 */
export const teamChangedFor = async (team, campaignId) => {
  const crews = await runningCrews(campaignId, team?.organizationId);
  return {
    departed: (team?.coordinatorIds || []).map(String).filter((id) => !crews.has(id)),
    returned: (team?.pastCoordinatorIds || []).map(String).filter((id) => crews.has(id)),
  };
};

const validateCrews = async ({ campaignId, organizationId = null, coordinatorIds }) => {
  const ids = sortedIdStrings(coordinatorIds);
  if (!ids.length) throw new SeriesError(400, 'TEAM_NEEDS_CREW', 'Pick at least one crew for this team.');
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw new SeriesError(400, 'TEAM_CREW_INVALID', 'Invalid crew.');
  const crews = await runningCrews(campaignId, organizationId);
  const missing = ids.filter((id) => !crews.has(id));
  if (missing.length) {
    throw new SeriesError(400, 'TEAM_CREW_NOT_RUNNING', 'One of the crews you picked no longer runs on this campaign.', {
      coordinatorIds: missing,
    });
  }
  return ids.map(oid);
};

const refuseNamedLabel = async (campaignId, label, extraUserIds = []) => {
  const names = await namesInLabel({ campaignId, label, extraUserIds });
  if (names.length) {
    throw new SeriesError(400, 'TEAM_LABEL_HAS_NAME', "Report names can't include a canvasser's name.", { names });
  }
};

// "A name that matches any series with published reports is refused with Continue" (§O4): reusing an
// ended team's name offers to continue it instead of starting a new run the client would confuse.
const refuseEndedName = async (campaignId, label) => {
  const ended = await ClientReportSeries.find(
    { campaignId, labelKey: labelKeyOf(label), endedAt: { $ne: null } },
    { _id: 1, kind: 1, label: 1 }
  ).lean();
  for (const s of ended) {
    if (await ClientReport.exists({ seriesId: s._id, status: 'published' })) {
      throw new SeriesError(409, 'SERIES_NAME_ENDED', `"${s.label}" is a team you ended. Continue it, or choose a different name.`, {
        seriesId: String(s._id),
        canContinue: s.kind === 'team',
      });
    }
  }
};

/** Create a team series: a label the client reads and one or more crews. */
export const createTeamSeries = async ({ organizationId, campaignId, label, coordinatorIds, createdBy }) => {
  const clean = cleanLabel(label);
  const crews = await validateCrews({ campaignId, organizationId, coordinatorIds });
  await refuseNamedLabel(campaignId, clean, crews);
  await refuseEndedName(campaignId, clean);
  try {
    const created = await ClientReportSeries.create({
      organizationId,
      campaignId,
      kind: 'team',
      label: clean,
      labelKey: labelKeyOf(clean),
      coordinatorIds: crews,
      pastCoordinatorIds: [],
      crewKeys: crews,
      createdBy,
    });
    return created.toObject();
  } catch (err) {
    if (isDup(err)) throw (await seriesConflict(err, { campaignId, label: clean, crewKeys: crews })) || err;
    throw err;
  }
};

/**
 * Edit a team (rename, change crews, keep or remove a departed lead's past doors, end, continue) or
 * rename a walk-list series. One CAS on what was read (updatedAt), so two edits can't interleave.
 * Returns { before, after }.
 */
export const editSeries = async ({ series, patch, by }) => {
  const set = {};
  const team = series.kind === 'team';
  if (patch.label !== undefined) {
    if (series.kind === 'campaign' || series.kind === 'team_walk_list') {
      throw new SeriesError(400, 'SERIES_LABEL_FIXED', "This tab's name can't be changed here.");
    }
    const clean = cleanLabel(patch.label);
    if (team) await refuseNamedLabel(series.campaignId, clean, crewKeysOf(series));
    else if (!patch.confirmLabel) {
      // A walk-list label naming a canvasser gets a warning the operator can confirm: place names
      // often are names ("Marco Island").
      const names = await namesInLabel({ campaignId: series.campaignId, label: clean });
      if (names.length) {
        throw new SeriesError(400, 'WALK_LIST_LABEL_HAS_NAME', 'This name matches a canvasser on this campaign. Confirm if it is a place, not a person.', {
          names,
          confirmable: true,
        });
      }
    }
    if (labelKeyOf(clean) !== series.labelKey) await refuseEndedName(series.campaignId, clean);
    set.label = clean;
    set.labelKey = labelKeyOf(clean);
  }

  let current = (series.coordinatorIds || []).map(String);
  let past = (series.pastCoordinatorIds || []).map(String);
  if (team && patch.coordinatorIds !== undefined) {
    const crews = (await validateCrews({ campaignId: series.campaignId, organizationId: series.organizationId, coordinatorIds: patch.coordinatorIds })).map(String);
    // A crew picked again leaves the past list; one dropped from the picker is simply not in the team.
    current = crews;
    past = past.filter((id) => !crews.includes(id));
  }
  if (team && Array.isArray(patch.keepPast) && patch.keepPast.length) {
    // "Keep her past doors in Paid team" (the default): she moves to past, still counted, exempt from
    // the crew check.
    const keep = patch.keepPast.map(String).filter((id) => current.includes(id));
    current = current.filter((id) => !keep.includes(id));
    past = [...new Set([...past, ...keep])];
  }
  if (team && Array.isArray(patch.removePast) && patch.removePast.length) {
    // "Remove them": her past doors leave the team's numbers from the next build on.
    const drop = new Set(patch.removePast.map(String));
    current = current.filter((id) => !drop.has(id));
    past = past.filter((id) => !drop.has(id));
  }
  if (team && Array.isArray(patch.makeCurrent) && patch.makeCurrent.length) {
    // A past coordinator who runs a crew again: make her crew current in the team.
    const crews = await runningCrews(series.campaignId, series.organizationId);
    const back = patch.makeCurrent.map(String).filter((id) => past.includes(id) && crews.has(id));
    past = past.filter((id) => !back.includes(id));
    current = [...new Set([...current, ...back])];
  }
  if (team) {
    set.coordinatorIds = current.map(oid);
    set.pastCoordinatorIds = past.map(oid);
    set.crewKeys = uniqIds([...current, ...past]);
  }
  if (patch.end === true && !series.endedAt) {
    set.endedAt = new Date();
    set.endedBy = by || null;
  }
  if (patch.continue === true && series.endedAt) {
    if (team) {
      // Continue re-validates the crews the way Change crews does.
      const crews = await validateCrews({ campaignId: series.campaignId, organizationId: series.organizationId, coordinatorIds: patch.coordinatorIds ?? current });
      set.coordinatorIds = crews;
      set.pastCoordinatorIds = (set.pastCoordinatorIds || []).filter((id) => !crews.some((c) => String(c) === String(id)));
      set.crewKeys = uniqIds([...crews, ...(set.pastCoordinatorIds || [])]);
    }
    set.endedAt = null;
    set.endedBy = null;
  }
  if (!Object.keys(set).length) return { before: series, after: series };
  try {
    const after = await ClientReportSeries.findOneAndUpdate(
      { _id: series._id, updatedAt: series.updatedAt },
      { $set: set },
      { new: true }
    ).lean();
    if (!after) throw new SeriesError(409, 'SERIES_CHANGED', 'This team was just changed by someone else — reload and try again.');
    return { before: series, after };
  } catch (err) {
    if (isDup(err)) {
      throw (await seriesConflict(err, { campaignId: series.campaignId, label: set.label || series.label, crewKeys: set.crewKeys || [] })) || err;
    }
    throw err;
  }
};

/**
 * The team picker and the series list for a campaign (§F4 "The picker", §G2): every series with its
 * current label, the campaign's current crews (free, in another team, or past in one), former crews
 * still named by a team, and how many canvassers have no coordinator. The route checks the campaign
 * is in the organization first; every read here carries the organization too (SEC-1).
 */
export const seriesPicker = async ({ organizationId, campaignId }) => {
  const [series, crews, assignments, efforts] = await Promise.all([
    ClientReportSeries.find({ organizationId, campaignId }).sort({ createdAt: 1 }).lean(),
    runningCrews(campaignId, organizationId),
    CampaignAssignment.find({ organizationId, campaignId }, { userId: 1, coordinatorId: 1 }).lean(),
    Effort.find({ organizationId, campaignId }, { name: 1 }).lean(),
  ]);
  const effortName = new Map(efforts.map((e) => [String(e._id), e.name]));
  const byId = new Map(series.map((s) => [String(s._id), s]));
  const reportCounts = await ClientReport.aggregate([
    { $match: { organizationId: oid(organizationId), campaignId: oid(campaignId), seriesId: { $in: series.map((s) => s._id) } } },
    { $group: { _id: '$seriesId', reports: { $sum: 1 }, published: { $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] } } } },
  ]);
  const counts = new Map(reportCounts.map((r) => [String(r._id), r]));

  const activeTeams = series.filter((s) => s.kind === 'team' && !s.endedAt);
  const coordIds = [
    ...crews.keys(),
    ...activeTeams.flatMap((t) => [...(t.coordinatorIds || []), ...(t.pastCoordinatorIds || [])].map(String)),
  ];
  const people = await hydrateCanvassers(coordIds, organizationId);
  const nameOf = (id) => {
    const p = people.get(String(id));
    return p ? [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Unknown user' : 'Unknown user';
  };

  const teamFor = (id) => activeTeams.find((t) => (t.coordinatorIds || []).some((c) => String(c) === id));
  const pastTeamFor = (id) => activeTeams.find((t) => (t.pastCoordinatorIds || []).some((c) => String(c) === id));
  const crewRows = [...crews.entries()].map(([id, members]) => {
    const inTeam = teamFor(id);
    const pastIn = pastTeamFor(id);
    return {
      coordinatorId: id,
      name: nameOf(id),
      members,
      inSeries: inTeam ? { id: String(inTeam._id), label: inTeam.label } : null,
      pastInSeries: pastIn ? { id: String(pastIn._id), label: pastIn.label } : null,
    };
  });
  const formerCrews = [];
  for (const t of activeTeams) {
    for (const id of (t.coordinatorIds || []).map(String)) {
      if (!crews.has(id)) formerCrews.push({ coordinatorId: id, name: nameOf(id), seriesId: String(t._id), seriesLabel: t.label, reason: 'no_longer_coordinates' });
    }
  }
  const coordinatorSet = new Set(crews.keys());
  const noCrewCanvassers = assignments.filter((a) => !a.coordinatorId && !coordinatorSet.has(String(a.userId))).length;

  const rows = [];
  for (const s of series) {
    const parent = s.kind === 'team_walk_list' ? byId.get(String(s.teamSeriesId)) || null : null;
    const c = counts.get(String(s._id));
    rows.push({
      id: String(s._id),
      seriesKey: seriesKeyForSeries(s),
      kind: s.kind,
      label: await seriesLabelOf(s, { team: parent, effortName: s.effortId ? effortName.get(String(s.effortId)) || null : null }),
      effortId: s.effortId ? String(s.effortId) : null,
      teamSeriesId: s.teamSeriesId ? String(s.teamSeriesId) : null,
      coordinators: (s.coordinatorIds || []).map((id) => ({ id: String(id), name: nameOf(id), runsCrew: crews.has(String(id)) })),
      pastCoordinators: (s.pastCoordinatorIds || []).map((id) => ({ id: String(id), name: nameOf(id), runsCrew: crews.has(String(id)) })),
      ended: !!s.endedAt || (s.kind === 'team_walk_list' && (!parent || !!parent.endedAt)),
      endedAt: s.endedAt || null,
      reports: c?.reports || 0,
      publishedReports: c?.published || 0,
    });
  }
  return { series: rows, crews: crewRows, formerCrews, noCrewCanvassers };
};

/**
 * The "team changed" card (§F4, §O4): who no longer runs a crew, what became of her canvassers, and
 * what removing her past doors would take out of the team's numbers; and any past coordinator
 * running a crew again. `effortId` and `rangeEndUtc` are the report the card is about (its walk list
 * and its period's end): "Remove them" is counted against what that report's next build counts.
 */
export const teamChangedCard = async ({ organizationId, campaignId, team, effortId = null, rangeEndUtc = null }) => {
  const { departed, returned } = await teamChangedFor(team, campaignId);
  const ids = [...departed, ...returned];
  if (!ids.length) return { departed: [], returned: [] };
  // The team's doors as its next build counts them (buildReportSnapshot.js): one per (household,
  // round) knocked by any of these crews — stamped rows plus each lead's own — never desk-entered
  // (NOT_BULK), before the report's end. "Remove them" is the team's count with her crew minus
  // without it (NUM-4): a door another crew of the team also knocked that round stays, and a knock
  // after the report's period never counted in it.
  const teamDoors = async (crews) => {
    if (!crews.length) return 0;
    const scope = {
      organizationId: oid(organizationId),
      campaignId: oid(campaignId),
      ...(effortId ? { effortId: oid(effortId) } : {}),
      ...NOT_BULK,
      ...(rangeEndUtc ? { timestamp: { $lt: new Date(rangeEndUtc) } } : {}),
    };
    const [k] = await CanvassActivity.aggregate(knocksPipeline(withTeam(scope, crewsMatch(crews))));
    return k?.knocks || 0;
  };
  const crewKeys = crewKeysOf(team).map(String);
  const allDoors = departed.length ? await teamDoors(crewKeys) : 0;
  const people = await hydrateCanvassers(ids, organizationId);
  const nameOf = (id) => {
    const p = people.get(String(id));
    return p ? [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Unknown user' : 'Unknown user';
  };
  const departedRows = [];
  for (const id of departed) {
    // Her former crew = the canvassers whose doors carry her stamp; where they are now.
    const stamped = await CanvassActivity.distinct('userId', { organizationId: oid(organizationId), campaignId: oid(campaignId), coordinatorId: oid(id) });
    const now = await CampaignAssignment.find({ organizationId, campaignId, userId: { $in: stamped } }, { userId: 1, coordinatorId: 1 }).lean();
    const moved = new Map();
    let noCrew = 0;
    for (const a of now) {
      if (!a.coordinatorId) noCrew += 1;
      else moved.set(String(a.coordinatorId), (moved.get(String(a.coordinatorId)) || 0) + 1);
    }
    const movedNames = await hydrateCanvassers([...moved.keys()], organizationId);
    const withoutHer = await teamDoors(crewKeys.filter((c) => c !== String(id)));
    departedRows.push({
      coordinatorId: id,
      name: nameOf(id),
      crewSize: stamped.length,
      noCrew,
      joined: [...moved.entries()].map(([cid, n]) => {
        const p = movedNames.get(cid);
        return { coordinatorId: cid, name: p ? [p.firstName, p.lastName].filter(Boolean).join(' ') : 'Unknown user', count: n };
      }),
      // What "Remove them" takes out of the team's totals: with her crew minus without it.
      removeDoors: Math.max(0, allDoors - withoutHer),
    });
  }
  return {
    departed: departedRows,
    returned: returned.map((id) => ({ coordinatorId: id, name: nameOf(id) })),
  };
};
