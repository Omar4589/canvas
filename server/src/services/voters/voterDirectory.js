import { Voter } from '../../models/Voter.js';
import { Household } from '../../models/Household.js';
import { Campaign } from '../../models/Campaign.js';
import { VotedVoter } from '../../models/VotedVoter.js';

// The voter directory — the ONE query behind both lists: the org-wide page (GET /admin/voters,
// admins only, where a validated ?campaignId narrows the view to one campaign) and the campaign
// Voters tab (GET /admin/campaigns/:campaignId/voters, every campaign manager — a lead sees only a
// campaign they were granted, and the URL is the scope). One owner on purpose: the 2026-09-30
// incident below was a three-pass whole-org pipeline, and a second copy of the handler would be a
// second place for the next one to hide. The routers keep the HTTP layer — the role gates, the
// page params (pageParams), the 503 mapping (isDirectoryTimeout) — and hand this an orgId, a
// campaignId that is ALREADY authorized (an ObjectId from a validated query param, or the campaign
// the URL named and the gate admitted; null for the org-wide view), the raw filter query, and a
// clamped page. Both lists answer the same shape: { voters, total, limit, skip }.

// What the client shows when the budget below expires; both routes send it as 503 DIRECTORY_TIMEOUT.
export const DIRECTORY_TIMEOUT_MESSAGE =
  'The voter directory took too long to load. Pick a campaign to narrow it, or try again.';

// The budget expired: mongod aborted the operation, so nothing keeps running server-side. The
// routes turn this into an honest, coded 503 instead of Heroku's HTML one — the web client shows
// the sentence and a Retry, and never re-runs a capped request on its own. Same expiry check as
// services/export/exportBuilders.js (the driver sets both; a bare code 50 must do).
export function isDirectoryTimeout(err) {
  return err?.codeName === 'MaxTimeMSExpired' || err?.code === 50;
}

// Paging as every directory route clamps it: 25 rows by default, 1–200, never a negative skip.
// `skip` — the house paging param (this was the last route saying `offset`; the web client is
// the only caller and ships with the server, so the rename has no compat window).
export function pageParams(query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 200);
  const skip = Math.max(parseInt(query.skip, 10) || 0, 0);
  return { limit, skip };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// One page of the directory. `query` is the route's raw req.query (party, surveyStatus, precinct,
// dnc, doorAdded, voted, search — a ?campaignId in it is NOT read here; the caller decides the
// scope); `limit`/`skip` come from pageParams. The budget starts the moment this is called.
export async function listVoters({ orgId, campaignId = null, query = {}, limit, skip }) {
  // ONE wall-clock budget per request, spent across every database call the handler makes
  // (each call gets what is left, so the sequential phases — the address search before the
  // aggregations, the guard's recompute after them — can never add up past the budget and
  // back into Heroku's 30 s router). Without it an abandoned request — the browser gave up, or
  // the router already answered 503 — kept its aggregations running on Atlas until
  // socketTimeoutMS (120 s), and the client's automatic retry stacked a second set on top.
  // mongod aborts the operation at expiry, so an abandoned page now costs at most the budget.
  // Read at call time (the exportEstimates.js pattern) so a test can move it; a missing or
  // malformed Config Var falls back to the default rather than taking the page down (NaN
  // reaches mongod as BadValue). Expiry answers a coded 503 — see isDirectoryTimeout above.
  const configuredBudget = Number(process.env.VOTER_DIRECTORY_MAX_MS);
  const budgetMs = Number.isFinite(configuredBudget) && configuredBudget > 0 ? configuredBudget : 15000;
  const deadline = Date.now() + budgetMs;
  const remaining = () => Math.max(1, deadline - Date.now());

  const filter = { organizationId: orgId };
  if (query.party) filter.party = query.party;
  if (query.surveyStatus) filter.surveyStatus = query.surveyStatus;
  if (query.precinct) filter.precinct = query.precinct;
  // Do-not-contact filter — org-wide by nature (the flag lives on the org-scoped Voter, no
  // campaign gymnastics like `voted` needs below).
  if (query.dnc === 'true') filter['doNotContact.flagged'] = true;
  else if (query.dnc === 'false') filter['doNotContact.flagged'] = { $ne: true };
  // "Added at the door" filter — walk-up rows a canvasser typed (rides the partial
  // {organizationId, 'doorAdded.at'} index; single-direction like party/precinct).
  if (query.doorAdded === 'true') filter['doorAdded.at'] = { $exists: true };

  // Voter rows are per-campaign — a direct filter, no household round-trip, and it always
  // resolves to THIS campaign's row of a shared person (never "whichever imported last").
  if (campaignId) filter.campaignId = campaignId;

  // voted filter — campaign-scoped when a campaign is selected, else org-wide.
  if (query.voted === 'true' || query.voted === 'false') {
    const vf = { organizationId: orgId };
    if (campaignId) vf.campaignId = campaignId;
    const votedIds = await VotedVoter.distinct('voterId', vf).maxTimeMS(remaining());
    filter._id = query.voted === 'true' ? { $in: votedIds } : { $nin: votedIds };
  }

  const search = (query.search || '').trim();
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    // Under a campaign scope the address match narrows to the campaign too. Households are
    // per-campaign like voters (a row's door is a door of its own campaign), so the rows that
    // come back are the same — the voter filter already carries campaignId, and another
    // campaign's door could never join it — but the $in holds this campaign's doors only, the
    // regex scans those doors off the campaignId index instead of every door in the org, and
    // the 5000-door cap is spent on doors that can match: org-wide it filled up with every
    // campaign's doors in index order, so a big org's campaign view could miss its own matches.
    const addrHh = (
      await Household.find(
        {
          organizationId: orgId,
          ...(campaignId ? { campaignId } : {}),
          $or: [{ addressLine1: rx }, { city: rx }, { zipCode: rx }],
        },
        '_id'
      )
        .limit(5000)
        .maxTimeMS(remaining())
        .lean()
    ).map((h) => h._id);
    filter.$or = [{ fullName: rx }, { stateVoterId: search }, { householdId: { $in: addrHh } }];
  }

  // Org-wide view of a multi-campaign org: dedupe by person (stateVoterId) so someone
  // imported into two campaigns is ONE directory row — their first-sorted row is the
  // primary, `campaigns` chips collect everywhere their MATCHING rows appear, and
  // surveyStatus reads surveyed-in-any. Single-campaign orgs (and any campaign-scoped view)
  // keep the plain indexed find — rows and people are the same thing there.
  //
  // The gate counts EVERY Campaign doc of the org, archived and deleting included: their rows
  // still exist and still need deduping. The same count is the multiplier of the prefix below.
  // A campaign-scoped read never dedupes (rows and people are the same thing there), so skip the
  // gate's count rather than spend a round-trip on a number nothing reads.
  const campaignCount = campaignId ? 0 : await Campaign.countDocuments({ organizationId: orgId }).maxTimeMS(remaining());
  const needsDedupe = !campaignId && campaignCount > 1;

  let rows;
  let total;
  let extrasByVoterId = null; // person-level extras from the dedupe branch
  if (needsDedupe) {
    // The 2026-09-30 incident: this branch used to sort every org document (a blocking SORT —
    // no index carried the _id tie-break), $group them WHOLE ($first: '$$ROOT'), then sort the
    // people — three whole-org passes per page load, spilling to disk past ~150k rows and
    // blowing Heroku's 30 s router on a 325k-person org. Now the pre-group sort rides the
    // covering directory index (models/Voter.js), the group keeps three small fields, and a
    // BOUNDED PREFIX makes the page O(page), not O(org):
    //
    //   Unique {campaignId, stateVoterId} means a person has at most `campaignCount` rows, so
    //   the first (skip + limit) × campaignCount keys in directory order are guaranteed to hold
    //   the first skip + limit PEOPLE, each with its $first row — a person's rows can only be
    //   preceded by earlier people's rows. Everything past the prefix belongs to people who
    //   sort after the page.
    //
    // Chips and surveyed-in-any are NOT taken from the group (over a prefix they would be
    // partial); they come from a sibling lookup of the page's people under the SAME filter,
    // which keeps filter-then-dedupe semantics exact: a person's chips are the campaigns of
    // the rows that matched, and 'surveyed' means surveyed in one of those rows. The count
    // pipeline is untouched — MongoDB already runs it as a covered DISTINCT_SCAN on
    // {organizationId, stateVoterId}, and it is the one cost left that grows with the org.
    const groupStage = {
      $group: {
        _id: '$stateVoterId',
        docId: { $first: '$_id' },
        lastName: { $first: '$lastName' },
        firstName: { $first: '$firstName' },
      },
    };
    const pagePipeline = (prefix) => [
      { $match: filter },
      // Pre-group sort makes $first deterministic (the person's first row in directory
      // order); post-group sort orders the PEOPLE the same way for paging.
      { $sort: { lastName: 1, firstName: 1, _id: 1 } },
      ...(prefix ? [{ $limit: prefix }] : []),
      groupStage,
      { $sort: { lastName: 1, firstName: 1, docId: 1 } },
      { $skip: skip },
      { $limit: limit },
    ];
    const runPage = (prefix) =>
      Voter.aggregate(pagePipeline(prefix)).allowDiskUse(true).option({ maxTimeMS: remaining() });
    let [people, totalAgg] = await Promise.all([
      runPage((skip + limit) * campaignCount),
      Voter.aggregate([
        { $match: filter },
        { $group: { _id: '$stateVoterId' } },
        { $count: 'n' },
      ])
        .allowDiskUse(true)
        .option({ maxTimeMS: remaining() }),
    ]);
    total = totalAgg[0]?.n || 0;
    // Short-page guard. The prefix bound assumes at most campaignCount rows per person; rows
    // orphaned by a Campaign doc that is gone (a half-finished delete) could exceed it and
    // starve the page. `total` is exact, so a page shorter than it should be is detectable —
    // recompute it unbounded (the same pipeline minus the prefix) rather than ship a short
    // page. Never expected in practice; logged so it is visible if it happens.
    const expected = Math.max(0, Math.min(limit, total - skip));
    if (people.length < expected) {
      console.warn(
        `[voters] directory prefix under-delivered (${people.length}/${expected}, org ${orgId}); recomputing unbounded`
      );
      people = await runPage(null);
    }
    const pageIds = people.map((p) => p.docId);
    const pageDocs = pageIds.length
      ? await Voter.find({ _id: { $in: pageIds } }).maxTimeMS(remaining()).lean()
      : [];
    const docById = new Map(pageDocs.map((d) => [String(d._id), d]));
    // Re-establish the pipeline's order: a $in fetch returns rows in index order, not ours.
    rows = pageIds.map((id) => docById.get(String(id))).filter(Boolean);
    extrasByVoterId = new Map(
      rows.map((v) => [String(v._id), { campaignIds: [], surveyedAny: false }])
    );
    const primaryBySvid = new Map(rows.map((v) => [v.stateVoterId, String(v._id)]));
    const siblings = rows.length
      ? await Voter.find(
          { ...filter, stateVoterId: { $in: [...primaryBySvid.keys()] } },
          'stateVoterId campaignId surveyStatus'
        )
          .maxTimeMS(remaining())
          .lean()
      : [];
    for (const s of siblings) {
      const extras = extrasByVoterId.get(primaryBySvid.get(s.stateVoterId));
      if (!extras) continue;
      const cid = String(s.campaignId);
      if (!extras.campaignIds.includes(cid)) extras.campaignIds.push(cid);
      if (s.surveyStatus === 'surveyed') extras.surveyedAny = true;
    }
  } else {
    [rows, total] = await Promise.all([
      Voter.find(filter)
        .sort({ lastName: 1, firstName: 1 })
        .skip(skip)
        .limit(limit)
        .maxTimeMS(remaining())
        .lean(),
      Voter.countDocuments(filter).maxTimeMS(remaining()),
    ]);
  }

  // Resolve household/campaign + voted flag for the page.
  const hhIds = [...new Set(rows.map((v) => String(v.householdId)).filter(Boolean))];
  const households = hhIds.length
    ? await Household.find(
        { _id: { $in: hhIds } },
        'addressLine1 city state campaignId'
      )
        .maxTimeMS(remaining())
        .lean()
    : [];
  const hMap = new Map(households.map((h) => [String(h._id), h]));
  const campIds = [
    ...new Set([
      ...households.map((h) => String(h.campaignId)).filter(Boolean),
      // Deduped people may span campaigns beyond their primary row's household.
      ...(extrasByVoterId ? [...extrasByVoterId.values()].flatMap((e) => e.campaignIds) : []),
    ]),
  ];
  const camps = campIds.length
    ? await Campaign.find({ _id: { $in: campIds } }, 'name').maxTimeMS(remaining()).lean()
    : [];
  const cMap = new Map(camps.map((c) => [String(c._id), c.name]));
  const votedRows = rows.length
    ? await VotedVoter.find({ voterId: { $in: rows.map((v) => v._id) } }, 'voterId campaignId')
        .maxTimeMS(remaining())
        .lean()
    : [];
  const votedByVoter = new Map();
  for (const r of votedRows) {
    if (!votedByVoter.has(String(r.voterId))) votedByVoter.set(String(r.voterId), new Set());
    votedByVoter.get(String(r.voterId)).add(String(r.campaignId));
  }

  const voters = rows.map((v) => {
    const h = hMap.get(String(v.householdId));
    const hcamp = h ? String(h.campaignId) : null;
    const extras = extrasByVoterId?.get(String(v._id)) || null;
    return {
      id: String(v._id),
      fullName: v.fullName,
      firstName: v.firstName,
      lastName: v.lastName,
      stateVoterId: v.stateVoterId,
      party: v.party || null,
      // Deduped org view reads surveyed-in-ANY-campaign; row views read the row.
      surveyStatus: extras ? (extras.surveyedAny ? 'surveyed' : 'not_surveyed') : v.surveyStatus,
      dnc: !!v.doNotContact?.flagged,
      // Walk-up badge: at-date only here; who added lives on the profile.
      doorAdded: v.doorAdded ? { at: v.doorAdded.at } : null,
      voted: hcamp ? !!votedByVoter.get(String(v._id))?.has(hcamp) : false,
      household: h
        ? {
            id: String(h._id),
            addressLine1: h.addressLine1,
            city: h.city,
            state: h.state,
            campaignId: hcamp,
            campaignName: hcamp ? cMap.get(hcamp) || null : null,
          }
        : null,
      // Additive (dedupe path only): every campaign this person appears in.
      ...(extras
        ? { campaigns: extras.campaignIds.map((cid) => ({ id: cid, name: cMap.get(cid) || null })) }
        : {}),
    };
  });

  return { voters, total, limit, skip };
}
