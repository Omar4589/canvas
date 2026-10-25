import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Organization } from '../models/Organization.js';
import { Campaign } from '../models/Campaign.js';
import { Membership } from '../models/Membership.js';
import { paceConfig, entriesOf, visitsOf, judgeVisits, replayPauses } from '../services/audit/paceRule.js';
import { loadStandingRows, loadFrozenRows, mergeRows, loadUnitFacts } from '../services/audit/paceTimeline.js';
import { zonedDayStr } from '../utils/timezone.js';

// Automatic pause — the season replay across every customer organization (docs/PROPOSAL_PACE_PAUSE.md §I.2).
// READ-ONLY: it never writes. The same rule (services/audit/paceRule.js) and the same loader
// (services/audit/paceTimeline.js) as the live check, run with each would-be pause lifted at once, so it
// answers "how often would this have fired, and on what" — before the switch goes on, or before a tuning.
//
//   npm run replay:pace-pause                                  # every customer org, all history
//   npm run replay:pace-pause -- --since=2026-08-01             # rows from that day (00:00 UTC) on
//   npm run replay:pace-pause -- --door=20 --survey=50          # try other numbers
//
// Number flags: --door --survey --travel (meters a second) --window --fails --visit (seconds), the PACE_*
// values by their short names. COUNTS ONLY: no name, id, address or coordinate is ever printed, and a count
// under 3 prints as "fewer than 3" — staff can see an org's member list, so a 1 would point at a person.
// Internal orgs (the demo) and orgs being deleted are skipped. It is a full scan of the ledger: run it late in
// the evening.

const FLAG_KEYS = { door: 'doorSec', survey: 'surveySec', travel: 'travelMps', window: 'window', fails: 'failsToPause', visit: 'sameVisitSec' };
const LONG_HOP_M = 400;
const SINCE = /^\d{4}-\d{2}-\d{2}$/;

const parseArgs = (argv) => {
  const overrides = {};
  let since = null;
  for (const a of argv) {
    const m = /^--([a-z]+)=(.+)$/.exec(a);
    if (!m) return { error: `Unknown argument ${a}` };
    const [, key, value] = m;
    if (key === 'since') {
      if (!SINCE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return { error: `--since=${value} is not a date (YYYY-MM-DD).` };
      since = new Date(`${value}T00:00:00Z`);
    } else if (FLAG_KEYS[key]) overrides[FLAG_KEYS[key]] = value;
    else return { error: `Unknown flag --${key}` };
  }
  return { since, overrides };
};

const small = (n) => (n > 0 && n < 3 ? 'fewer than 3' : n.toLocaleString('en-US'));

const replayOrg = async (org, { since, config }) => {
  const campaigns = await Campaign.find({ organizationId: org._id }, 'timeZone').lean();
  const tzOf = new Map(campaigns.map((c) => [String(c._id), c.timeZone || org.timeZone || 'America/New_York']));
  // Judged by their role today (decision 13: only canvassers are ever paused), whatever their status now.
  const canvassers = await Membership.find({ organizationId: org._id, role: 'canvasser' }, 'userId').lean();
  const timestamp = since ? { $gte: since } : { $exists: true };
  const out = { canvassers: 0, days: 0, pausedDays: 0, pausedCanvassers: 0, pauses: 0, fails: 0, vehicle: 0, still: 0, walking: 0, longHopFails: 0, notHomeThenSurvey: 0 };
  for (const { userId } of canvassers) {
    const rows = mergeRows(await loadStandingRows(org._id, userId, timestamp), await loadFrozenRows(org._id, userId, timestamp));
    if (!rows.length) continue;
    out.canvassers += 1;
    const households = await loadUnitFacts(rows.map((r) => r.householdId));
    const entries = entriesOf(rows);
    const verdicts = judgeVisits(visitsOf(entries, config), entries, { households, config });
    const byDay = new Map();
    for (const v of verdicts) {
      if (!v.judged) continue;
      const d = zonedDayStr(new Date(v.visit.first.at), tzOf.get(String(v.visit.campaignId)) || org.timeZone || 'America/New_York');
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(v);
      if (v.fail) {
        out.fails += 1;
        if (v.pattern) out[v.pattern] += 1;
        if (v.meters >= LONG_HOP_M) out.longHopFails += 1;
      }
      if (v.visit.first.result === 'not_home' && v.visit.entries.some((e, i) => i > 0 && e.result === 'survey_submitted')) out.notHomeThenSurvey += 1;
    }
    let paused = false;
    for (const vs of byDay.values()) {
      out.days += 1;
      const { pauses } = replayPauses(vs, config);
      if (pauses.length) {
        out.pausedDays += 1;
        out.pauses += pauses.length;
        paused = true;
      }
    }
    if (paused) out.pausedCanvassers += 1;
  }
  return out;
};

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    console.error(parsed.error);
    process.exit(2);
  }
  const config = paceConfig(process.env, parsed.overrides);
  await connectDb(process.env.MONGODB_URI);
  console.log('Automatic pause — season replay (read-only; counts only)');
  console.log(`Rule: ${config.doorSec} s at a door, ${config.surveySec} s for a survey, ${config.travelMps} m/s travel, ${config.failsToPause} fails in ${config.window}, visits ${config.sameVisitSec} s`);
  console.log(`Rows: ${parsed.since ? `from ${parsed.since.toISOString().slice(0, 10)}` : 'all history'}\n`);

  const orgs = await Organization.find({ isInternal: { $ne: true }, 'deletion.requestedAt': null }, 'name timeZone').sort({ name: 1 }).lean();
  const total = { orgs: 0, canvassers: 0, days: 0, pausedDays: 0, pausedCanvassers: 0, pauses: 0 };
  for (const org of orgs) {
    const r = await replayOrg(org, { since: parsed.since, config });
    if (!r.canvassers) continue;
    total.orgs += 1;
    for (const k of ['canvassers', 'days', 'pausedDays', 'pausedCanvassers', 'pauses']) total[k] += r[k];
    console.log(`${org.name}`);
    console.log(`  canvassers ${small(r.canvassers)} · canvasser-days ${small(r.days)}`);
    console.log(`  would have paused: ${small(r.pauses)} time(s), on ${small(r.pausedDays)} canvasser-day(s), ${small(r.pausedCanvassers)} canvasser(s)`);
    console.log(`  too-fast visits ${small(r.fails)} — vehicle speed ${small(r.vehicle)} · from one spot ${small(r.still)} · walking pace ${small(r.walking)} · on hops of ${LONG_HOP_M} m or more ${small(r.longHopFails)}`);
    console.log(`  visits that began Not home and ended surveyed ${small(r.notHomeThenSurvey)}\n`);
  }
  console.log(`All customer orgs: ${small(total.orgs)} with canvassing · ${small(total.canvassers)} canvassers · ${small(total.days)} canvasser-days · would have paused ${small(total.pauses)} time(s) on ${small(total.pausedDays)} canvasser-day(s)`);
  console.log('Nothing was changed.');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
