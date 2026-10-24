import { PlatformStats, PLATFORM_METRICS } from '../../models/PlatformStats.js';
import { PlatformDaily } from '../../models/PlatformDaily.js';
import { Subscription } from '../../models/Subscription.js';
import { Organization } from '../../models/Organization.js';
import { Campaign } from '../../models/Campaign.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { Voter } from '../../models/Voter.js';
import { KNOCK_ACTIONS, NOT_BULK } from '../reports/aggregations.js';

// Lifetime marketing counters. See models/PlatformStats.js for the two-bucket (live/deleted) design.
// Everything here EXCLUDES `internal` organizations — synthetic demo data never touches these numbers.

const KEY = { key: 'singleton' };

// Name of the nightly reconcile job (registered in services/retention/scheduler.js
// MAINTENANCE_JOBS; the handler calls recomputeLive below). Lives here beside the service
// it names, mirroring JOB_NAME in retention/purgeDeletedIdentities.js.
export const STATS_JOB = 'platform-stats-reconcile';

// How many times a capture counts before it gives up — it counts again only when one of its own org's
// campaigns is banked or goes away while it counts — and how many banks it tries per count, when other
// banks land in between (each try is one read and one write). A reconcile counts the whole platform,
// so any bank is its business; it counts again once, then gives up rather than hold Reconcile now
// past Heroku's 30-second request limit.
const CAPTURE_COUNTS = 3;
const BANK_TRIES = 10;
const RECONCILE_COUNTS = 2;

// The per-metric row filters for the orgs `org` matches (a filter on organizationId), leaving out the
// rows of the `banked` campaigns: the one definition of a counted row. The live bucket, the trend
// series and both captures build from it, so a capture banks exactly the rows `live` counted.
const metricMatches = (org, banked) => {
  const notBanked = banked.length ? { campaignId: { $nin: banked } } : {};
  return {
    organizations: { _id: org },
    campaigns: { organizationId: org, ...(banked.length ? { _id: { $nin: banked } } : {}) },
    doorsKnocked: { organizationId: org, ...notBanked, actionType: { $in: KNOCK_ACTIONS }, ...NOT_BULK },
    surveyResponses: { organizationId: org, ...notBanked },
    votersProcessed: { organizationId: org, ...notBanked },
  };
};

// The bank ledger as one snapshot (models/PlatformStats.js): `seq`, bumped by every bank, and the ids
// banked while their deletion runs. Read in ONE query, so a capture counts under exactly the ledger its
// bank is then conditional on.
const readBank = async () => {
  const doc = await PlatformStats.findOne(KEY, { bank: 1 }).lean();
  return { seq: doc?.bank?.seq ?? 0, orgs: doc?.bank?.orgs ?? [], campaigns: doc?.bank?.campaigns ?? [] };
};

// `seq` still reading as it did: 0 also matches a singleton written before the ledger existed.
const seqIs = (seq) => ({ 'bank.seq': seq || { $in: [0, null] } });

const hasId = (ids, id) => ids.some((x) => String(x) === String(id));

// A conditional write on the singleton must not upsert — on a no-match it would try to insert a second
// singleton and hit the unique `key` — so the document is made sure of first.
const ensureSingleton = () => PlatformStats.updateOne(KEY, { $setOnInsert: KEY }, { upsert: true });

// The filter behind every LIVE number; the bucket (computeLiveCounts) and the trend series
// (computeDailySeries) both apply it. A row is live unless its org is one of Doorline's own
// demo/internal orgs, or its org or campaign is already BANKED — in the ledger, or marked
// platformStatsCaptured (everything banked before the ledger existed carries only the mark). A capture
// moves a condemned org's or campaign's counts into the permanent `deleted` bucket at the START of its
// cascade, while its rows still exist — minutes to hours on the worker, and indefinitely if the cascade
// fails and waits for Retry — so counting those rows in `live` too would double them in the total.
//
// Keyed on the bank, NEVER on deletion.requestedAt. A delete still waiting in the queue, or one that
// failed before its capture ran, has banked nothing: excluding it made the total dip at the next
// reconcile, and its capture then subtracted it from `live` a second time. Pass the `ledger` snapshot
// a caller's write will be conditional on, so the count and the condition read the same bank.
const liveMatches = async (ledger) => {
  const [bankNow, internal, orgs, campaigns] = await Promise.all([
    ledger || readBank(),
    Subscription.find({ status: 'internal' }, 'organizationId').lean(),
    Organization.find({ $or: [{ isInternal: true }, { platformStatsCaptured: true }] }, '_id').lean(),
    Campaign.find({ platformStatsCaptured: true }, '_id').lean(),
  ]);
  const excluded = [...internal.map((s) => s.organizationId), ...orgs.map((o) => o._id), ...bankNow.orgs];
  const banked = [...campaigns.map((c) => c._id), ...bankNow.campaigns];
  return metricMatches(excluded.length ? { $nin: excluded } : { $exists: true }, banked);
};

// One org's campaigns as a capture sees them under `ledger`: the banked ones (marked, or in the
// ledger), whose rows it leaves out, and a fingerprint of the ones it counts — live and unbanked. A
// bank that missed compares fingerprints to tell whether its count still stands.
const campaignsOf = async (organizationId, ledger) => {
  const rows = await Campaign.find({ organizationId }, { platformStatsCaptured: 1 }).lean();
  const inLedger = new Set(ledger.campaigns.map(String));
  return {
    banked: [...rows.filter((c) => c.platformStatsCaptured).map((c) => c._id), ...ledger.campaigns],
    counted: rows
      .filter((c) => !c.platformStatsCaptured && !inLedger.has(String(c._id)))
      .map((c) => String(c._id))
      .sort()
      .join(),
  };
};

// Doorline's own demo/internal orgs: the born-immutable flag, which outlives the whole delete cascade,
// or the billing status coupled to it — the same either-or billing reads (services/billing/invoicing.js).
async function isInternalOrg(orgId) {
  const [flagged, billed] = await Promise.all([
    Organization.exists({ _id: orgId, isInternal: true }),
    Subscription.exists({ organizationId: orgId, status: 'internal' }),
  ]);
  return !!(flagged || billed);
}

// Distinct PEOPLE — {organizationId, stateVoterId} pairs — under `match`. Voter rows are
// per-campaign, so a raw row count would double-count a person imported into two campaigns
// of one org; votersProcessed has always meant people. (The same person in two ORGS still
// counts twice — orgs are separate universes, decision 13.)
async function countPeople(match) {
  const [r] = await Voter.aggregate([
    { $match: match },
    { $group: { _id: { org: '$organizationId', svid: '$stateVoterId' } } },
    { $count: 'n' },
  ]).allowDiskUse(true);
  return r?.n || 0;
}

/**
 * Live increment for a single metric. Best-effort and non-fatal: a marketing counter must never take
 * down the request that triggered it, and the backfill recomputes the live bucket anyway, so a lost
 * increment self-heals. Pass `isInternal` when the caller already knows it (the entitlement middleware
 * attaches req.subscription, so the knock/survey hot paths pay no extra query); otherwise it's resolved.
 */
export async function bumpLive(metric, n = 1, { isInternal, orgId } = {}) {
  try {
    if (!n || !PLATFORM_METRICS.includes(metric)) return;
    const internal = isInternal ?? (orgId ? await isInternalOrg(orgId) : false);
    if (internal) return;
    await PlatformStats.updateOne(KEY, { $inc: { [`live.${metric}`]: n } }, { upsert: true });
  } catch {
    // swallow — see doc comment
  }
}

// Mark an org or campaign captured (platformStatsCaptured): banked, or with nothing to bank. It is the
// cheap "already done" a retry checks first, and the sign the late-write sweep waits for before it
// counts a cascade as begun (lateWriteSweep.js). Set only AFTER the bank, so it never stands for a bank
// that didn't land; a crash between the two is covered by the ledger, which a retry also reads.
const mark = (Model, _id) => Model.updateOne({ _id }, { $set: { platformStatsCaptured: true } });

// Bank one org's or campaign's counts: move them from `live` to `deleted`, add its id to the ledger and
// bump `seq`, in ONE conditional pipeline update on the singleton — so the bank is its own claim, and
// it lands whole or not at all. It lands only if no other bank landed since the caller read `seq` (the
// caller counted under the ledger as it still is) and this id isn't banked already. live is clamped at
// 0 (a missed live increment must never make a counter negative; the next reconcile re-syncs live
// exactly). Resolves true when it landed. The singleton must exist already (ensureSingleton).
const bank = async (captured, seq, ledger, id) => {
  const ids = `bank.${ledger}`;
  const set = { 'bank.seq': seq + 1, [ids]: { $concatArrays: [{ $ifNull: [`$${ids}`, []] }, [id]] } };
  for (const m of PLATFORM_METRICS) {
    const c = captured[m] || 0;
    set[`deleted.${m}`] = { $add: [{ $ifNull: [`$deleted.${m}`, 0] }, c] };
    set[`live.${m}`] = { $max: [0, { $subtract: [{ $ifNull: [`$live.${m}`, 0] }, c] }] };
  }
  const res = await PlatformStats.updateOne({ ...KEY, ...seqIs(seq), [ids]: { $ne: id } }, [{ $set: set }]);
  return res.matchedCount === 1;
};

/**
 * Drop the ledger ids whose org or campaign is gone. An entry only has to outlive the captures that
 * could still bank its id, and every capture reads its document first, so once the document is gone
 * the entry has no job left — and the ledger must not keep a deleted customer's ids past their
 * deletion. Called at the end of both cascades and by every reconcile, which catches what a crash left.
 */
export const pruneBank = async () => {
  const { orgs, campaigns } = await readBank();
  if (!orgs.length && !campaigns.length) return;
  const [orgsLeft, campaignsLeft] = await Promise.all([
    orgs.length ? Organization.distinct('_id', { _id: { $in: orgs } }) : [],
    campaigns.length ? Campaign.distinct('_id', { _id: { $in: campaigns } }) : [],
  ]);
  const goneOrgs = orgs.filter((id) => !hasId(orgsLeft, id));
  const goneCampaigns = campaigns.filter((id) => !hasId(campaignsLeft, id));
  if (!goneOrgs.length && !goneCampaigns.length) return;
  await PlatformStats.updateOne(KEY, { $pull: { 'bank.orgs': { $in: goneOrgs }, 'bank.campaigns': { $in: goneCampaigns } } });
};

// The protocol both captures share: count under a snapshot of the bank ledger, then bank against it.
// A bank that misses because another bank landed meanwhile looks at what changed. Banks elsewhere
// leave the count standing, so it banks again under the new `seq`; but if one of this org's
// campaigns was banked or went away meanwhile, the count is stale and runs again. (A pruned
// campaign's document is gone, so pruning can never hide that change.) `settle(ledger)` says, before
// each count and after each miss, whether there is nothing to do: 'done' (the document is gone or
// already marked) or 'mark' (banked already, or nothing to bank — mark it and stop).
const captureWithBank = async ({ Model, id, organizationId, ledger: key, settle, count }) => {
  await ensureSingleton(); // bank's conditional write must not upsert
  const stop = async (ledger) => {
    const verdict = await settle(ledger);
    if (verdict === 'mark') await mark(Model, id);
    return !!verdict;
  };
  for (let counting = 1; counting <= CAPTURE_COUNTS; counting += 1) {
    let ledger = await readBank();
    if (await stop(ledger)) return null;
    const { banked, counted } = await campaignsOf(organizationId, ledger);
    const captured = await count(banked);
    for (let tries = 1; tries <= BANK_TRIES; tries += 1) {
      if (await bank(captured, ledger.seq, key, id)) {
        await mark(Model, id);
        return captured;
      }
      ledger = await readBank();
      if (await stop(ledger)) return null;
      if ((await campaignsOf(organizationId, ledger)).counted !== counted) break; // stale: count again
    }
  }
  throw new Error('Other deletions kept banking while this was counted — retry the delete.');
};

/**
 * Capture an organization's lifetime contribution the instant BEFORE its rows are destroyed. Call this
 * at the top of the org-deletion cascade. Returns the captured counts (or null for an internal org,
 * which is excluded, and for one an earlier attempt already banked). Counts actual rows — the source
 * of truth — never a running tally.
 *
 * COUNT, THEN BANK — and the bank is its own claim. The add is not idempotent on its own (organizations
 * += 1 every call) and the delete queue retries a failed cascade, so something must say "banked
 * already". That used to be the platformStatsCaptured flag, set BEFORE the count: a count that died
 * partway (a database blip, or the worker killed on a deploy, both inside the minutes an org-wide count
 * takes) left the org marked banked with nothing banked, every retry skipped it, and the org was gone
 * from the lifetime totals for good. Now the ledger entry and the counts land in one write or not at
 * all, so a failed attempt leaves nothing and its retry counts again. And the bank lands only against
 * the ledger this count read: a campaign capture banking meanwhile sends this round to count again,
 * instead of banking that campaign twice.
 */
export async function captureOrgBeforeDelete(orgId) {
  return captureWithBank({
    Model: Organization,
    id: orgId,
    organizationId: orgId,
    ledger: 'orgs',
    settle: async (ledger) => {
      const org = await Organization.findById(orgId, { platformStatsCaptured: 1 }).lean();
      if (!org || org.platformStatsCaptured) return 'done'; // gone, or captured by an earlier attempt
      // Banked by an earlier attempt that died before its mark — or internal, which banks nothing but
      // still takes the mark, since the late-write sweep waits for it.
      if (hasId(ledger.orgs, orgId) || (await isInternalOrg(orgId))) return 'mark';
      return null;
    },
    // `banked` holds any campaign whose own hard-delete banked it and then stopped partway: it is
    // already in `deleted`, so this cascade destroys its rows but must not bank them a second time.
    count: async (banked) => {
      const match = metricMatches(orgId, banked);
      const [campaigns, doorsKnocked, surveyResponses, votersProcessed] = await Promise.all([
        Campaign.countDocuments(match.campaigns),
        CanvassActivity.countDocuments(match.doorsKnocked),
        SurveyResponse.countDocuments(match.surveyResponses),
        countPeople(match.votersProcessed),
      ]);
      return { organizations: 1, campaigns, doorsKnocked, surveyResponses, votersProcessed };
    },
  });
}

// The people a campaign's delete actually removes from its org's live universe: distinct ids in
// the campaign with NO row in another campaign that is still live. A person shared with a live
// sibling lives on there — banking them into `deleted` while that row still counts in `live`
// would double them in the total. A row in one of the `banked` campaigns (its delete stopped
// partway) does NOT keep a person alive: it is out of `live` already and goes with its own
// cascade, so a person whose every row is in deleted campaigns is banked by the last of those
// captures instead of by none.
// Aggregation cursor, NOT distinct(): distinct returns one BSON document hard-capped at
// 16MB, which ~600k stateVoterIds would blow — making a huge campaign permanently
// undeletable. The $group rides the unique {campaignId, stateVoterId} index; batches of
// 5000 keep each sibling distinct() far under the cap.
const peopleLeaving = async (campaignId, organizationId, banked) => {
  const cursor = Voter.aggregate([{ $match: { campaignId } }, { $group: { _id: '$stateVoterId' } }])
    .allowDiskUse(true)
    .cursor();
  let total = 0;
  let survivors = 0;
  let batch = [];
  const flushBatch = async () => {
    if (!batch.length) return;
    const s = await Voter.find({
      organizationId,
      stateVoterId: { $in: batch },
      campaignId: { $nin: [campaignId, ...banked] },
    }).distinct('stateVoterId');
    survivors += s.length;
    batch = [];
  };
  for await (const doc of cursor) {
    total += 1;
    batch.push(doc._id);
    if (batch.length >= 5000) await flushBatch();
  }
  await flushBatch();
  return Math.max(0, total - survivors);
};

/**
 * Capture a single campaign's contribution before a standalone campaign delete destroys its rows. (Org
 * deletion uses captureOrgBeforeDelete instead, which skips a campaign this already banked, so every
 * row is banked by exactly one of the two.) `organizations` is 0 here — the org lives on.
 *
 * Count, then bank, the org capture's way and for its reasons: deleteCampaignCascade is sequential and
 * non-transactional and its job is retried, so the bank (campaigns:1 plus its voters, into the
 * permanent `deleted` bucket the backfill never recomputes) is its own claim. It stands down when its
 * org's capture got there first — that capture counted this campaign while it was still unbanked — and
 * counts again when its org or a sibling campaign banks while it counts.
 */
export async function captureCampaignBeforeDelete(campaign) {
  const campaignId = campaign._id;
  const orgId = campaign.organizationId;
  return captureWithBank({
    Model: Campaign,
    id: campaignId,
    organizationId: orgId,
    ledger: 'campaigns',
    settle: async (ledger) => {
      const [current, org] = await Promise.all([
        Campaign.findById(campaignId, { platformStatsCaptured: 1 }).lean(),
        Organization.findById(orgId, { platformStatsCaptured: 1 }).lean(),
      ]);
      if (!current || current.platformStatsCaptured) return 'done'; // gone, or captured by an earlier attempt
      // Banked by an earlier attempt that died before its mark; or its org's capture banked first,
      // counting this campaign in, so banking it too would double it; or internal, which banks
      // nothing. (An org that is merely missing banked nothing — its campaign's rows still count in
      // `live` — so that campaign banks as usual.)
      const orgBanked = hasId(ledger.orgs, orgId) || !!org?.platformStatsCaptured;
      if (hasId(ledger.campaigns, campaignId) || orgBanked || (await isInternalOrg(orgId))) return 'mark';
      return null;
    },
    count: async (banked) => {
      const scoped = metricMatches(orgId, []);
      const [votersProcessed, doorsKnocked, surveyResponses] = await Promise.all([
        peopleLeaving(campaignId, orgId, banked),
        CanvassActivity.countDocuments({ ...scoped.doorsKnocked, campaignId }),
        SurveyResponse.countDocuments({ ...scoped.surveyResponses, campaignId }),
      ]);
      return { organizations: 0, campaigns: 1, doorsKnocked, surveyResponses, votersProcessed };
    },
  });
}

/**
 * The current live counts from real rows — liveMatches' filter: internal orgs and anything already
 * banked are excluded. READ-ONLY — used both by the backfill dry run (to preview without writing) and
 * by recomputeLive (to persist), which passes the bank `ledger` its write will be conditional on.
 */
export async function computeLiveCounts(ledger) {
  const match = await liveMatches(ledger);
  const [organizations, campaigns, doorsKnocked, surveyResponses, votersProcessed] = await Promise.all([
    Organization.countDocuments(match.organizations),
    Campaign.countDocuments(match.campaigns),
    CanvassActivity.countDocuments(match.doorsKnocked),
    SurveyResponse.countDocuments(match.surveyResponses),
    countPeople(match.votersProcessed),
  ]);
  return { organizations, campaigns, doorsKnocked, surveyResponses, votersProcessed };
}

/**
 * Recompute the LIVE bucket from the current rows (computeLiveCounts), and SET it (idempotent —
 * running twice yields the same result, and the `deleted` bucket is never touched). This is the backfill
 * body, and it doubles as the drift-corrector: any live increment ever missed is made exact here. It
 * also prunes the bank ledger of orgs and campaigns already gone.
 *
 * The SET waits on the bank. A capture that banks while this counts has already taken its rows out of
 * `live` — rows this count may have read as live a moment earlier — so writing the count over it would
 * hold them in both buckets until the next reconcile. The write lands only if the ledger's `seq` still
 * reads as it did when the count began; if it doesn't, the count runs once more, and a second miss
 * fails the reconcile (run it again) rather than hold Reconcile now past the request limit.
 */
export async function recomputeLive({ stampBackfill = false } = {}) {
  await pruneBank();
  await ensureSingleton(); // the conditional SET below must not upsert
  for (let counting = 1; counting <= RECONCILE_COUNTS; counting += 1) {
    const ledger = await readBank();
    const live = await computeLiveCounts(ledger);
    const set = {};
    for (const m of PLATFORM_METRICS) set[`live.${m}`] = live[m];
    if (stampBackfill) set.backfilledAt = new Date();
    const res = await PlatformStats.updateOne({ ...KEY, ...seqIs(ledger.seq) }, { $set: set });
    if (res.matchedCount) return live;
  }
  throw new Error('Deletions kept banking while the platform stats were recounted — run the reconcile again.');
}

// ── The per-day trend series (PlatformDaily) ─────────────────────────────────────────────────────

// The date field each metric buckets by. CanvassActivity.timestamp and SurveyResponse.submittedAt
// are `required: true`; Organization/Campaign/Voter only have createdAt via `timestamps: true`,
// which Mongoose stamps on WRITE — a pre-existing row may have none. That is exactly why `undated`
// below is counted independently instead of assumed zero.
const DAILY_SOURCES = {
  organizations: { dateField: 'createdAt' },
  campaigns: { dateField: 'createdAt' },
  doorsKnocked: { dateField: 'timestamp' },
  surveyResponses: { dateField: 'submittedAt' },
  votersProcessed: { dateField: 'createdAt' },
};

/**
 * The full per-day series from real rows, plus the per-metric count of rows that carry NO date
 * (and so can never appear in any bucket). READ-ONLY — same role computeLiveCounts plays for the
 * live bucket, over the SAME filter (liveMatches: internal orgs and anything already banked
 * excluded; knocks = KNOCK_ACTIONS, never via:'bulk'), so `Σ(days[m]) + undated[m] ===
 * computeLiveCounts()[m]` when the data is quiescent.
 * Days are UTC ('%Y-%m-%d' with no timezone) — a platform series has no campaign anchor tz.
 */
export async function computeDailySeries() {
  const live = await liveMatches();
  const matches = {
    organizations: [Organization, live.organizations],
    campaigns: [Campaign, live.campaigns],
    doorsKnocked: [CanvassActivity, live.doorsKnocked],
    surveyResponses: [SurveyResponse, live.surveyResponses],
    votersProcessed: [Voter, live.votersProcessed],
  };

  const byDay = new Map();
  const undated = {};
  for (const metric of PLATFORM_METRICS) {
    const [Model, match] = matches[metric];
    const { dateField } = DAILY_SOURCES[metric];
    // votersProcessed counts PEOPLE (per-campaign rows would double-count a person imported
    // into two campaigns), so bucket each {org, person} pair once, on its FIRST row's
    // createdAt — re-importing a known person into a sibling campaign adds a row, not a bar.
    if (metric === 'votersProcessed') {
      const [buckets, missing] = await Promise.all([
        Voter.aggregate([
          { $match: { ...match, [dateField]: { $type: 'date' } } },
          { $group: { _id: { org: '$organizationId', svid: '$stateVoterId' }, first: { $min: `$${dateField}` } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$first' } }, n: { $sum: 1 } } },
        ]).allowDiskUse(true),
        // Dateless = pairs with NO dated row at all (a real count, not a residual — keeps the
        // trend invariant an actual cross-check against countPeople, like the row metrics).
        Voter.aggregate([
          { $match: match },
          {
            $group: {
              _id: { org: '$organizationId', svid: '$stateVoterId' },
              hasDate: { $max: { $cond: [{ $eq: [{ $type: `$${dateField}` }, 'date'] }, 1, 0] } },
            },
          },
          { $match: { hasDate: 0 } },
          { $count: 'n' },
        ]).allowDiskUse(true),
      ]);
      undated[metric] = missing[0]?.n || 0;
      for (const b of buckets) {
        const row = byDay.get(b._id) || {};
        row[metric] = b.n;
        byDay.set(b._id, row);
      }
      continue;
    }
    const [buckets, missing] = await Promise.all([
      // $dateToString throws on a null/missing date, so bucket only real dates …
      Model.aggregate([
        { $match: { ...match, [dateField]: { $type: 'date' } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: `$${dateField}` } }, n: { $sum: 1 } } },
      ]),
      // … and count the dateless rows SEPARATELY (not as a residual), so the trend invariant is a
      // real cross-check of this bucketing rather than true by definition.
      Model.countDocuments({ ...match, $or: [{ [dateField]: null }, { [dateField]: { $exists: false } }] }),
    ]);
    undated[metric] = missing;
    for (const b of buckets) {
      const row = byDay.get(b._id) || {};
      row[metric] = b.n;
      byDay.set(b._id, row);
    }
  }

  const days = [...byDay.entries()]
    .map(([day, metrics]) => {
      const row = { day };
      for (const m of PLATFORM_METRICS) row[m] = metrics[m] || 0;
      return row;
    })
    .sort((a, b) => (a.day < b.day ? -1 : 1));
  return { days, undated };
}

/**
 * Rebuild the PlatformDaily collection in FULL from computeDailySeries() and stamp the `undated`
 * counts on the singleton. Full replacement (upsert every computed day, delete the rest) is the
 * point: after an org hard-delete its rows vanish, so its bars must drop out of history — the
 * `deleted` bank preserves the total while this series stays exactly what surviving rows support.
 * Idempotent and self-healing, like recomputeLive. Runs nightly in the same STATS_JOB, from the
 * manual backfill, and from the Control Room's "Reconcile now".
 */
export async function recomputeDaily() {
  const { days, undated } = await computeDailySeries();
  if (days.length) {
    await PlatformDaily.bulkWrite(
      days.map((d) => ({ updateOne: { filter: { day: d.day }, update: { $set: d }, upsert: true } })),
      { ordered: false }
    );
  }
  await PlatformDaily.deleteMany({ day: { $nin: days.map((d) => d.day) } });
  const set = {};
  for (const m of PLATFORM_METRICS) set[`undated.${m}`] = undated[m];
  await PlatformStats.updateOne(KEY, { $set: set }, { upsert: true });
  const undatedTotal = PLATFORM_METRICS.reduce((s, m) => s + undated[m], 0);
  if (undatedTotal > 0) {
    // Loud on purpose: dateless rows mean the trend charts under-draw by exactly these counts.
    console.warn(`[platform-stats] ${undatedTotal} row(s) have no date and cannot appear in the trend series:`, undated);
  }
  return { days: days.length, undated };
}

/** The public marketing view: total (live + deleted) per metric, plus the raw buckets for auditing. */
export async function getPlatformStats() {
  const doc = (await PlatformStats.findOne(KEY).lean()) || {};
  const live = doc.live || {};
  const deleted = doc.deleted || {};
  const undated = doc.undated || {};
  const total = {};
  for (const m of PLATFORM_METRICS) total[m] = (live[m] || 0) + (deleted[m] || 0);
  return {
    total,
    live,
    deleted,
    undated: Object.fromEntries(PLATFORM_METRICS.map((m) => [m, undated[m] || 0])),
    backfilledAt: doc.backfilledAt || null,
  };
}
