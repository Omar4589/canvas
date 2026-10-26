import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Organization } from '../models/Organization.js';
import { ClientReport } from '../models/ClientReport.js';
import { ClientReportSeries } from '../models/ClientReportSeries.js';
import { seriesEnded } from '../services/reports/clientReportSeries.js';
import { dayOfWeek, nextPeriod, weekStartOf, reportWeekStartsOnOf } from '../services/reports/reportPeriods.js';

// Client report tabs against their organization's report week (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md
// §C, §H). READ-ONLY: it never writes. Prints, per organization, how many open tabs' latest report runs
// whole weeks on a weekday other than the organization's — the tabs whose New report will show the nudge
// ("Your last Whole campaign report ran Wednesday – Tuesday. Your organization's report weeks run Monday –
// Sunday."), most of them because a tab's weeks started on whatever day its first report was made.
//
//   npm run report:tab-weeks
//
// Before or after the deploy; from the repo root (Heroku dashboard → More → Run console). A tab's latest
// report is the one with the newest end — of two that end the same day, the newer made (createdAt, then
// _id) — as New report reads it. Ended teams and tabs are left out (New report never offers them). Counts
// and organization names only — no report, campaign or person is named.
// One pass over the client reports, projected down to their dates, so it is cheap at any time of day.

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekWords = (start, end) => `${DAY[dayOfWeek(start)]} – ${DAY[dayOfWeek(end)]}`;
const n = (v) => v.toLocaleString('en-US');

// The nudge's own test (§C): the latest report is whole weeks — rule 2, never a month that happens to be
// four weeks — starting on another weekday. Rule 2's next period starts on the report's weekday; rule 3a's
// always on the organization's, so it never counts.
const offWeek = (latest, s) => {
  const next = nextPeriod(latest, s, latest.weekEnd);
  return next.kind === 'weeks' && weekStartOf(next.weekStart, s) !== next.weekStart;
};

const main = async () => {
  const extra = process.argv.slice(2);
  if (extra.length) {
    console.error(`Unknown argument: ${extra.join(' ')}\nUsage: npm run report:tab-weeks`);
    process.exit(2);
  }
  // Read-only on every database: outside production connectDb turns autoIndex on, which would build
  // every imported model's indexes (and create its collection) on the database being read.
  await connectDb(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
  console.log("Client report tabs and the organization's report week (read-only; counts only)\n");

  // Not lean: the week is read through the schema's cast, as the app reads req.activeOrg (orgContext's
  // findById), so a week stored as a string ("3") is Wednesday here too, never reportWeekStartsOnOf's Monday.
  const orgs = await Organization.find({ 'deletion.requestedAt': null }, 'name isInternal reportWeekStartsOn').sort({ name: 1 });
  // Every tab's latest report in one pass: project to the dates first, so the sort never carries a report.
  const latest = await ClientReport.aggregate([
    { $match: { seriesId: { $ne: null } } },
    { $project: { seriesId: 1, organizationId: 1, weekStart: 1, weekEnd: 1, createdAt: 1 } },
    { $sort: { seriesId: 1, weekEnd: -1, createdAt: -1, _id: -1 } },
    { $group: { _id: '$seriesId', organizationId: { $first: '$organizationId' }, weekStart: { $first: '$weekStart' }, weekEnd: { $first: '$weekEnd' } } },
  ]).allowDiskUse(true);
  const untabbed = await ClientReport.countDocuments({ seriesId: null });
  const series = await ClientReportSeries.find({}, { kind: 1, endedAt: 1, teamSeriesId: 1 }).lean();
  const byId = new Map(series.map((s) => [String(s._id), s]));
  const byOrg = new Map();
  for (const row of latest) {
    const key = String(row.organizationId);
    if (!byOrg.has(key)) byOrg.set(key, []);
    byOrg.get(key).push(row);
  }

  const total = { orgs: 0, tabs: 0, off: 0, ended: 0 };
  for (const org of orgs) {
    const s = reportWeekStartsOnOf(org);
    let tabs = 0;
    let ended = 0;
    const off = new Map(); // "Wednesday – Tuesday" → tabs
    for (const row of byOrg.get(String(org._id)) || []) {
      const tab = byId.get(String(row._id));
      const parent = tab?.kind === 'team_walk_list' ? byId.get(String(tab.teamSeriesId)) || null : undefined;
      if (!tab || (await seriesEnded(tab, parent))) {
        ended += 1;
        continue;
      }
      tabs += 1;
      if (offWeek(row, s)) {
        const words = weekWords(row.weekStart, row.weekEnd);
        off.set(words, (off.get(words) || 0) + 1);
      }
    }
    if (!tabs && !ended) continue;
    const offCount = [...off.values()].reduce((a, b) => a + b, 0);
    total.orgs += 1;
    total.tabs += tabs;
    total.off += offCount;
    total.ended += ended;
    console.log(`${org.name}${org.isInternal ? ' (Doorline internal)' : ''} — report weeks ${DAY[s]} – ${DAY[(s + 6) % 7]}`);
    console.log(`  ${n(tabs)} open tab(s) with reports · ${n(offCount)} will show the week nudge`);
    if (offCount) {
      const parts = [...off.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w, c]) => `${w}: ${n(c)}`);
      console.log(`    their weeks: ${parts.join(' · ')}`);
    }
    if (ended) console.log(`  (${n(ended)} ended tab(s) not counted)`);
    console.log('');
  }
  console.log(`All organizations: ${n(total.orgs)} with client report tabs · ${n(total.tabs)} open tab(s) · ${n(total.off)} will show the week nudge${total.ended ? ` · ${n(total.ended)} ended tab(s) not counted` : ''}`);
  if (untabbed) console.log(`${n(untabbed)} report(s) from before tabs existed are in no tab and not counted.`);
  console.log('Nothing was changed.');
  await mongoose.disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
