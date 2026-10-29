// End the passes still live on archived walk lists, and the extra live passes of any walk list
// holding two or more (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §C.11).
//
// Why this exists: archiving a walk list used to change only its label. Its live pass kept running,
// so canvassers kept its books and the Walk Lists page said "archived" and "Live" on one row (the
// Help Center told admins to archive the leftover "Main" list after a split, so it happened). Archiving
// now ends the live pass (services/passes/passLifecycle.js); this ends the ones left behind, exactly
// as a new archive would, so each can be brought back with Unarchive. It also ends all but the latest
// live pass of a walk list holding several — an old state the app can no longer create, and one the
// one_live_pass_per_walk_list index (models/Pass.js) refuses to build over.
//
// The dry run lists, by organization (internal ones first, then customers by name) and campaign
// (archived campaigns flagged):
//   - archived walk lists with a live pass: the pass, its published books, how many canvassers are
//     assigned to them, the last knock's date, and whether it was knocked in the last 2 days;
//   - walk lists of any kind with two or more live passes, and which one stays live;
//   - how many live passes have no walk list (the index's $type filter skips those; left alone).
// It prints counts and organization, campaign, walk list and pass names — never a canvasser's or a
// voter's name, and a canvasser count under 3 as "fewer than 3": staff can see an organization's member
// list, so a 1 would point at a person (item 39's rule, replayPacePause.js). It runs in the staff console
// across customer organizations, outside any support grant (§J; PRIVACY_VERIFICATION.md item 43(g)).
//
// --apply calls repairWalkList (the one writer) for each listed walk list, in any campaign state but
// one being deleted (its passes go with it, and a History row written now could outlive the delete): it
// ends every live pass of an archived walk list (archivedVia 'repair', no actor; the walk list keeps
// its own archive date, and Unarchive offers back the pass last activated) and every live pass but
// the latest of an open one, with a History row per pass ended. A walk list someone is changing right
// now is skipped and named: re-run to finish. Re-running is safe — a repaired walk list no longer
// matches.
//
// Heroku dashboard → More → Run console (outside field hours for --apply):
//   npm run repair:archived-walk-lists                                  (dry run: reports, writes nothing)
//   npm run repair:archived-walk-lists -- --apply
//   npm run repair:archived-walk-lists -- --campaign <id> [--apply]     (one campaign)
// Then build the index: npm run migrate:build-indexes (dry run first), then -- --apply.
import 'dotenv/config';
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { connectDb } from '../config/db.js';
import { Organization } from '../models/Organization.js';
import { Campaign } from '../models/Campaign.js';
import { Effort } from '../models/Effort.js';
import { Pass } from '../models/Pass.js';
import { Turf } from '../models/Turf.js';
import { TurfAssignment } from '../models/TurfAssignment.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { KNOCK_ACTIONS } from '../services/reports/aggregations.js';
import { repairWalkList, LifecycleError } from '../services/passes/passLifecycle.js';
import { passLabel } from '../services/passes/passLabel.js';

const RECENT_MS = 2 * 24 * 60 * 60 * 1000;
const USAGE = 'Usage: npm run repair:archived-walk-lists -- [--campaign <id>] [--apply]';

const day = (d) => new Date(d).toISOString().slice(0, 10);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const canvasserCount = (n) => (n > 0 && n < 3 ? 'fewer than 3 canvassers' : plural(n, 'canvasser'));
const listOf = (labels) => (labels.length < 3 ? labels.join(' and ') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`);
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || '')) || String(a._id).localeCompare(String(b._id));

// Every walk list the repair would change, with what the owner needs to warn its organization. Live
// passes come sorted as repairWalkList sorts them, so the one said to stay live is the one it keeps.
const findWalkLists = async ({ campaignId, now }) => {
  const scope = campaignId ? { campaignId } : {};
  const [live, noWalkList] = await Promise.all([
    Pass.find({ ...scope, status: 'active', effortId: { $type: 'objectId' } }, { effortId: 1 }).lean(),
    // Raw driver: exactly the passes the index's $type filter leaves out.
    Pass.collection.countDocuments({ ...scope, status: 'active', effortId: { $not: { $type: 'objectId' } } }),
  ]);
  const liveCount = new Map();
  for (const p of live) liveCount.set(String(p.effortId), (liveCount.get(String(p.effortId)) || 0) + 1);
  const efforts = new Map(
    (await Effort.find({ _id: { $in: [...liveCount.keys()] } }, { name: 1, status: 1, campaignId: 1, organizationId: 1 }).lean()).map(
      (e) => [String(e._id), e]
    )
  );

  const walkLists = [];
  for (const [effortId, n] of liveCount) {
    const effort = efforts.get(effortId) || null;
    const archived = effort?.status === 'archived';
    if (!archived && n < 2) continue;
    const passes = await Pass.find(
      { effortId: new mongoose.Types.ObjectId(effortId), status: 'active' },
      { organizationId: 1, campaignId: 1, roundNumber: 1, name: 1 }
    )
      .sort({ lastActivatedAt: -1, activatedAt: -1 })
      .lean();
    if (!passes.length || (!archived && passes.length < 2)) continue; // changed since the first read
    const passIds = passes.map((p) => p._id);
    const [books, canvassers, [knock]] = await Promise.all([
      Turf.countDocuments({ passId: { $in: passIds }, status: 'published' }),
      TurfAssignment.distinct('userId', { passId: { $in: passIds } }),
      CanvassActivity.aggregate([
        { $match: { passId: { $in: passIds }, actionType: { $in: KNOCK_ACTIONS } } },
        { $group: { _id: null, last: { $max: '$timestamp' } } },
      ]),
    ]);
    const lastKnock = knock?.last || null;
    walkLists.push({
      effortId,
      effort,
      archived,
      campaignId: String(effort?.campaignId || passes[0].campaignId),
      organizationId: String(effort?.organizationId || passes[0].organizationId),
      passes,
      books,
      canvassers: canvassers.length,
      lastKnock,
      recent: !!lastKnock && new Date(lastKnock).getTime() >= now.getTime() - RECENT_MS,
    });
  }

  const [campaigns, orgs] = await Promise.all([
    Campaign.find({ _id: { $in: [...new Set(walkLists.map((w) => w.campaignId))] } }, { name: 1, isActive: 1, organizationId: 1, deletion: 1 }).lean(),
    Organization.find({ _id: { $in: [...new Set(walkLists.map((w) => w.organizationId))] } }, { name: 1, isInternal: 1 }).lean(),
  ]);
  const campaignById = new Map(campaigns.map((c) => [String(c._id), c]));
  const orgById = new Map(orgs.map((o) => [String(o._id), o]));
  for (const w of walkLists) {
    w.campaign = campaignById.get(w.campaignId) || null;
    w.org = orgById.get(w.organizationId) || null;
  }
  return { walkLists, noWalkList };
};

// Organizations (internal first, then customers) → campaigns → walk lists, each by name.
const grouped = (walkLists) => {
  const orgs = new Map();
  for (const w of walkLists) {
    if (!orgs.has(w.organizationId)) orgs.set(w.organizationId, { org: w.org, id: w.organizationId, campaigns: new Map() });
    const campaigns = orgs.get(w.organizationId).campaigns;
    if (!campaigns.has(w.campaignId)) campaigns.set(w.campaignId, { campaign: w.campaign, id: w.campaignId, walkLists: [] });
    campaigns.get(w.campaignId).walkLists.push(w);
  }
  return [...orgs.values()]
    .sort((a, b) => Number(!!b.org?.isInternal) - Number(!!a.org?.isInternal) || byName(a.org || { _id: a.id }, b.org || { _id: b.id }))
    .map((o) => ({
      ...o,
      campaigns: [...o.campaigns.values()]
        .sort((a, b) => byName(a.campaign || { _id: a.id }, b.campaign || { _id: b.id }))
        .map((c) => ({ ...c, walkLists: c.walkLists.sort((a, b) => byName(a.effort || { _id: a.effortId }, b.effort || { _id: b.effortId })) })),
    }));
};

const orgHeading = (o) => (o.org ? `${o.org.name}${o.org.isInternal ? ' (internal)' : ''}` : `Organization ${o.id} (not found)`);
const campaignHeading = (c) => {
  if (!c.campaign) return `Campaign ${c.id} (not found)`;
  const flags = [c.campaign.isActive === false && 'archived campaign', c.campaign.deletion?.requestedAt && 'being deleted'].filter(Boolean);
  return `Campaign "${c.campaign.name}"${flags.length ? ` (${flags.join(', ')})` : ''}`;
};

// One line per walk list: counts and names only (see the header).
const describe = (w) => {
  const labels = w.passes.map(passLabel);
  if (!w.effort) {
    return `Walk list ${w.effortId} (deleted): ${w.passes.length} live passes, ${listOf(labels)} — the repair can't change these; ask before building the index`;
  }
  if (w.archived) {
    return [
      `Archived walk list "${w.effort.name}": ${listOf(labels)} still live`,
      plural(w.books, 'published book'),
      `${canvasserCount(w.canvassers)} assigned`,
      w.lastKnock ? `last knock ${day(w.lastKnock)}` : 'no knocks yet',
      ...(w.recent ? ['knocked in the last 2 days'] : []),
    ].join('; ');
  }
  return [
    `Walk list "${w.effort.name}": ${w.passes.length} live passes`,
    `${labels[0]} stays live (started most recently)`,
    `${listOf(labels.slice(1))} ${w.passes.length > 2 ? 'end' : 'ends'}`,
  ].join('; ');
};

const where = (w) => [w.org?.name || w.organizationId, w.campaign?.name || w.campaignId, w.effort?.name || w.effortId].join(' / ');

// The core, for the console and the tests. Returns what it found and, with `apply`, what it did.
export const repairArchivedWalkLists = async ({ campaignId = null, apply = false, now = new Date(), log = console.log } = {}) => {
  const scopeId = campaignId ? new mongoose.Types.ObjectId(String(campaignId)) : null;
  const { walkLists, noWalkList } = await findWalkLists({ campaignId: scopeId, now });
  const out = { walkLists, noWalkList, ended: [], skipped: [], deleting: [], failed: [] };

  log(
    'Walk lists archived with a live pass, and walk lists with two or more live passes' +
      ` (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §C.11)${scopeId ? `, campaign ${scopeId} only` : ''}.` +
      (apply ? '' : ' DRY RUN — nothing is written.')
  );
  log('');
  const groups = grouped(walkLists);
  for (const o of groups) {
    log(orgHeading(o));
    for (const c of o.campaigns) {
      log(`  ${campaignHeading(c)}`);
      for (const w of c.walkLists) log(`    ${describe(w)}`);
    }
  }
  if (groups.length) log('');

  const archived = walkLists.filter((w) => w.archived);
  const several = walkLists.filter((w) => w.passes.length >= 2);
  // A campaign being deleted is listed but left alone by --apply (its passes go with it), so not counted.
  const deleting = walkLists.filter((w) => w.campaign?.deletion?.requestedAt);
  const toEnd = walkLists.reduce(
    (n, w) => n + (!w.effort || deleting.includes(w) ? 0 : w.archived ? w.passes.length : w.passes.length - 1),
    0
  );
  log(`Archived walk lists with a live pass: ${archived.length}${archived.length ? ` (${archived.filter((w) => w.recent).length} knocked in the last 2 days)` : ''}.`);
  log(
    `Walk lists with two or more live passes: ${several.length}` +
      `${several.some((w) => w.archived) ? ` (${several.filter((w) => w.archived).length} of them archived)` : ''}.`
  );
  log(`Live passes with no walk list: ${noWalkList}${noWalkList ? ' — left alone (the one-live-pass index skips them).' : '.'}`);

  if (!walkLists.length) {
    log('\nNothing to repair.');
    return out;
  }
  log(`Live passes to end: ${toEnd}, on ${plural(walkLists.length, 'walk list')} in ${plural(groups.length, 'organization')}.`);
  if (deleting.length) {
    log(`${plural(deleting.length, 'walk list')} in campaigns being deleted: listed, not counted above — --apply leaves them to the delete.`);
  }

  if (!apply) {
    log('\nDry run — nothing written. Tell the customers listed (above all, those knocked in the last 2 days), then,');
    log('outside field hours: npm run repair:archived-walk-lists -- --apply');
    return out;
  }

  log('\nAPPLYING');
  for (const w of groups.flatMap((o) => o.campaigns.flatMap((c) => c.walkLists))) {
    if (!w.effort || !w.campaign) {
      const error = w.effort ? 'its campaign no longer exists' : 'its walk list no longer exists';
      out.failed.push({ walkList: w, error });
      log(`  ${where(w)}: NOT CHANGED, ${error} — ask before building the index.`);
      continue;
    }
    // A campaign being deleted loses its passes anyway; History rows written now could land after the
    // delete's last sweep. Its live passes don't block the index once the delete finishes.
    if (w.campaign.deletion?.requestedAt) {
      out.deleting.push({ walkList: w });
      log(`  ${where(w)}: SKIPPED — its campaign is being deleted, and its passes go with it.`);
      continue;
    }
    try {
      const { ended } = await repairWalkList({ campaign: w.campaign, effortId: w.effort._id });
      out.ended.push(...ended.map((pass) => ({ walkList: w, pass })));
      const kept = w.archived ? null : w.passes.find((p) => !ended.some((e) => String(e._id) === String(p._id)));
      log(
        `  ${where(w)}: ${ended.length ? `ended ${listOf(ended.map(passLabel))}` : 'nothing left to end'}` +
          `${kept ? ` (${passLabel(kept)} stays live)` : ''}`
      );
    } catch (err) {
      if (!(err instanceof LifecycleError)) {
        out.failed.push({ walkList: w, error: err?.message || String(err) });
        log(`  ${where(w)}: FAILED — ${err?.message || err}`);
        continue;
      }
      // Someone is archiving, activating or re-cutting there right now (lifecycle-busy, recut-locked:
      // nothing on it changed), or a pass changed under it (one ended before that stays ended). A re-run
      // ends the rest.
      out.skipped.push({ walkList: w, code: err.code });
      log(`  ${where(w)}: SKIPPED (${err.code}) — ${err.message}`);
    }
  }
  log('');
  log(`Ended ${plural(out.ended.length, 'live pass', 'live passes')}.`);
  if (out.skipped.length) {
    log(`${plural(out.skipped.length, 'walk list')} skipped while someone was changing ${out.skipped.length === 1 ? 'it' : 'them'} — re-run to finish.`);
  }
  if (out.deleting.length) log(`${plural(out.deleting.length, 'walk list')} skipped in campaigns being deleted.`);
  if (out.failed.length) log(`${plural(out.failed.length, 'walk list')} not changed — see above.`);
  if (!out.skipped.length && !out.failed.length) {
    log(
      'Next: npm run migrate:build-indexes (it should list one_live_pass_per_walk_list), then -- --apply' +
        `${out.deleting.length ? ' — once those deletes have finished' : ''}.`
    );
  }
  return out;
};

// Run as a script (npm run repair:archived-walk-lists); import for tests. Anything but the two flags
// is refused: a mistyped scope must never widen an --apply to every campaign.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--campaign');
  const campaignArg = at === -1 ? null : args[at + 1];
  const known = args.every((a, i) => a === '--apply' || a === '--campaign' || (at !== -1 && i === at + 1));
  if (!known || (at !== -1 && !mongoose.isObjectIdOrHexString(campaignArg))) {
    console.error(USAGE);
    process.exit(1);
  }
  await connectDb(process.env.MONGODB_URI);
  try {
    const out = await repairArchivedWalkLists({ campaignId: campaignArg, apply: args.includes('--apply') });
    if (out.failed.length) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
