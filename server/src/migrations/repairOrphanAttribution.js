// Re-home ledger rows whose walk list (effortId) or round (passId) was DELETED.
//
// Why this exists: knocks stamp the door's owner at write time (resolveAttribution,
// routes/mobile/canvass.js), and deleting a walk list used to leave those stamps
// dangling — the by-pass report then shows them as a "Legacy / no pass" row that no
// admin can explain (2026-08 incident: 5 knocks recorded while doors sat in a
// temporary list, list deleted, knocks orphaned). The delete route now refuses when
// history references the list (routes/admin/efforts.js), so this script is the
// one-time repair for orphans created before that guard.
//
// The proposed re-stamp is the door's CURRENT walk list plus that list's round —
// the round is unambiguous only when the list has exactly one, or exactly one
// ACTIVE one. Anything else (door back in Intake, door deleted, several rounds
// none active) is REPORTED for manual review and never touched: evidence first,
// no guessing on attribution.
//
// --passless additionally targets rows that dangle on NOTHING but carry passId:null
// — knocks recorded while a door sat in a walk list with no active book over it
// (the incident's second class: doors moved BACK to their list but not yet re-cut).
// Their total counts were always right (the Legacy bucket is Σ-preserving); this
// only moves their ATTRIBUTION onto the list's round. It requires --campaign, on
// purpose: platform-wide, passId:null is the deliberate marker for genuinely
// pre-rounds-era history, and that label must keep meaning exactly that.
//
// Heroku dashboard → More → Run console:
//   npm run repair:orphan-attribution                          (dry run: reports, writes nothing)
//   npm run repair:orphan-attribution -- --apply
//   npm run repair:orphan-attribution -- --campaign <id> [--apply]   (scope to one campaign)
//   npm run repair:orphan-attribution -- --campaign <id> --passless [--apply]
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Effort } from '../models/Effort.js';
import { Pass } from '../models/Pass.js';
import { Household } from '../models/Household.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { SurveyResponse } from '../models/SurveyResponse.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PASSLESS = args.includes('--passless');
const campaignArg = args.includes('--campaign') ? args[args.indexOf('--campaign') + 1] : null;
if (campaignArg && !mongoose.isValidObjectId(campaignArg)) {
  console.error('Usage: npm run repair:orphan-attribution -- [--campaign <id>] [--passless] [--apply]');
  process.exit(1);
}
if (PASSLESS && !campaignArg) {
  console.error('--passless requires --campaign <id>: without a scope it would rewrite genuinely pre-rounds-era history platform-wide.');
  process.exit(1);
}
const scope = campaignArg ? { campaignId: new mongoose.Types.ObjectId(campaignArg) } : {};

await connectDb(process.env.MONGODB_URI);
try {
  // Which referenced efforts/passes no longer exist? distinct() over the ledger is a
  // one-off maintenance scan; --campaign bounds it when you know where the damage is.
  const findDangling = async (Model, field, Ref) => {
    const ids = (await Model.distinct(field, { ...scope, [field]: { $ne: null } })).map(String);
    if (!ids.length) return new Set();
    const alive = new Set((await Ref.find({ _id: { $in: ids } }, { _id: 1 }).lean()).map((d) => String(d._id)));
    return new Set(ids.filter((id) => !alive.has(id)));
  };

  const [deadEffortsA, deadEffortsR, deadPassesA, deadPassesR] = await Promise.all([
    findDangling(CanvassActivity, 'effortId', Effort),
    findDangling(SurveyResponse, 'effortId', Effort),
    findDangling(CanvassActivity, 'passId', Pass),
    findDangling(SurveyResponse, 'passId', Pass),
  ]);
  const deadEfforts = new Set([...deadEffortsA, ...deadEffortsR]);
  const deadPasses = new Set([...deadPassesA, ...deadPassesR]);

  if (!deadEfforts.size && !deadPasses.size && !PASSLESS) {
    console.log('No dangling walk-list or round references in the ledger. Nothing to do. (--passless targets round-less rows too.)');
    process.exit(0);
  }
  console.log(`Dangling refs: ${deadEfforts.size} deleted walk list(s), ${deadPasses.size} deleted round(s).${PASSLESS ? ' Also targeting passId:null rows (--passless).' : ''}`);

  const branches = [
    ...(deadEfforts.size ? [{ effortId: { $in: [...deadEfforts].map((id) => new mongoose.Types.ObjectId(id)) } }] : []),
    ...(deadPasses.size ? [{ passId: { $in: [...deadPasses].map((id) => new mongoose.Types.ObjectId(id)) } }] : []),
    // Round-less rows: nothing dangles, the row just never got a round (no active
    // book covered the door at write time). Campaign-scoped by the guard above.
    ...(PASSLESS ? [{ passId: null }] : []),
  ];
  const orphanFilter = { ...scope, $or: branches };

  // The round a re-homed row should land in: the door's current list's single
  // round, or its single ACTIVE round. Cached per effort.
  const passChoice = new Map(); // effortId -> { passId } | { ambiguous: reason }
  const choosePass = async (effortId) => {
    const key = String(effortId);
    if (passChoice.has(key)) return passChoice.get(key);
    const passes = await Pass.find({ effortId }, { _id: 1, status: 1, roundNumber: 1 }).lean();
    let out;
    if (passes.length === 1) out = { passId: passes[0]._id };
    else {
      const active = passes.filter((p) => p.status === 'active');
      if (active.length === 1) out = { passId: active[0]._id };
      else out = { ambiguous: `list has ${passes.length} rounds, ${active.length} active — pick manually` };
    }
    passChoice.set(key, out);
    return out;
  };

  let proposed = 0;
  let manual = 0;
  const DETAIL_CAP = 50;
  const plans = []; // [{ Model, _id, set }]

  for (const [label, Model] of [['knock', CanvassActivity], ['survey answer', SurveyResponse]]) {
    const rows = await Model.find(orphanFilter, { householdId: 1, effortId: 1, passId: 1, voterId: 1, userId: 1, timestamp: 1, createdAt: 1 }).lean();
    for (const row of rows) {
      const detail = proposed + manual < DETAIL_CAP;
      const door = row.householdId
        ? await Household.findById(row.householdId, { effortId: 1, addressLine1: 1, city: 1 }).lean()
        : null;
      const when = (row.timestamp || row.createdAt)?.toISOString?.() || '?';
      const where = door ? `${door.addressLine1 || '?'}, ${door.city || '?'}` : '(door deleted)';
      if (!door || !door.effortId) {
        manual += 1;
        if (detail) console.log(`  MANUAL ${label} ${row._id} @ ${where} ${when} — ${door ? 'door is back in Intake (no current list)' : 'door no longer exists'}`);
        continue;
      }
      const choice = await choosePass(door.effortId);
      if (choice.ambiguous) {
        manual += 1;
        if (detail) console.log(`  MANUAL ${label} ${row._id} @ ${where} ${when} — ${choice.ambiguous}`);
        continue;
      }
      // A survey answer can only re-home into a round the voter has NO answer in —
      // {voterId, passId} is unique (one answer per voter per round). A collision
      // means the voter was legitimately re-surveyed in that round; folding the
      // round-less row onto it would be wrong, so it stays for manual review.
      if (Model === SurveyResponse && row.voterId) {
        const clash = await SurveyResponse.exists({ voterId: row.voterId, passId: choice.passId, _id: { $ne: row._id } });
        if (clash) {
          manual += 1;
          if (detail) console.log(`  MANUAL ${label} ${row._id} @ ${where} ${when} — voter already has an answer in the target round`);
          continue;
        }
      }
      proposed += 1;
      if (detail) console.log(`  RESTAMP ${label} ${row._id} @ ${where} ${when} → current list ${door.effortId}, round ${choice.passId}`);
      plans.push({ Model, _id: row._id, set: { effortId: door.effortId, passId: choice.passId } });
    }
  }
  if (proposed + manual > DETAIL_CAP) console.log(`  … (${proposed + manual - DETAIL_CAP} more rows not itemized)`);

  console.log(`${proposed} row(s) would be re-stamped to their door's current list+round; ${manual} need manual review.`);

  if (APPLY && plans.length) {
    let applied = 0;
    let conflicted = 0;
    for (const p of plans) {
      try {
        await p.Model.updateOne({ _id: p._id }, { $set: p.set });
        applied += 1;
      } catch (err) {
        // Belt-and-braces for a unique-index race the pre-check above didn't see.
        if (err?.code === 11000) {
          conflicted += 1;
          console.log(`  CONFLICT ${p._id} — duplicate in the target round; left as-is for manual review.`);
        } else throw err;
      }
    }
    console.log(`APPLIED — ${applied} row(s) re-stamped${conflicted ? `, ${conflicted} conflict(s) skipped` : ''}. The "Legacy / no pass" report bucket should now hold only genuinely pre-rounds-era rows.`);
  } else if (!APPLY) {
    console.log('Dry run — re-run with --apply to write.');
  }
} finally {
  await mongoose.disconnect();
}
