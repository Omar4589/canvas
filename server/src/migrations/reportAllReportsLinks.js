import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Organization } from '../models/Organization.js';
import { ReportShareLink } from '../models/ReportShareLink.js';
import { shareLinksBlocked } from '../services/billing/entitlement.js';

// Old links to all your reports, by organization (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C6). READ-ONLY: it
// never writes. Run after the deploy and before RETIRE_ALL_REPORTS_LINKS is switched on: it lists every
// organization with a link that opens all of a campaign's reports (reportId null, or missing on a link made
// before the field) — whose clients lose a link on the day of the switch, and so which customers to tell
// first — and how many reports already got more than one link of their own before one link per report.
//
//   npm run report:all-reports-links
//
// From the repo root (Heroku dashboard → More → Run console). Per organization: how many such links still
// work, how many are off because of billing, turned off, or expired — each link counted once, in the order
// a client meets them (routes/public/share.js loadShare: a turned-off link is "not available" before
// anything else, then expiry, then billing — shareLinksBlocked, the public routes' own rule, read once per
// organization) — on how many campaigns, and when one was last opened; then how many of its reports have
// more than one link; then totals. Organizations whose links still work come first. Organization names and
// counts only — no campaign, label, token or person is named, as report:tab-weeks.

const n = (v) => v.toLocaleString('en-US');
const count = (v, one, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// A link as its client meets it today.
const stateOf = (link, blocked, now) =>
  link.isActive !== true ? 'turnedOff' : link.expiresAt && new Date(link.expiresAt) <= now ? 'expired' : blocked ? 'billing' : 'working';
const STATES = [
  ['working', 'still working'],
  ['billing', 'off because of billing'],
  ['turnedOff', 'turned off'],
  ['expired', 'expired'],
];
const tally = () => ({ links: 0, working: 0, billing: 0, turnedOff: 0, expired: 0, campaigns: 0 });
const statesLine = (t) => STATES.map(([key, words]) => `${n(t[key])} ${words}`).join(' · ');

const main = async () => {
  const extra = process.argv.slice(2);
  if (extra.length) {
    console.error(`Unknown argument: ${extra.join(' ')}\nUsage: npm run report:all-reports-links`);
    process.exit(2);
  }
  // Read-only on every database: outside production connectDb turns autoIndex on, which would build every
  // imported model's indexes, and autoCreate alone would still create each one's collection.
  await connectDb(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
  console.log('Old links to all your reports, by organization (read-only; organization names and counts only)\n');
  const now = new Date();

  // `reportId: null` also matches a link made before the field, where it's missing. Only what is counted
  // is read — never the token, the label or a password.
  const links = await ReportShareLink.find({ reportId: null }, { organizationId: 1, campaignId: 1, isActive: 1, expiresAt: 1, lastAccessedAt: 1 }).lean();
  // Reports with more than one link of their own (made before one link per report), per organization.
  const multi = await ReportShareLink.aggregate([
    { $match: { reportId: { $ne: null } } },
    { $group: { _id: '$reportId', organizationId: { $first: '$organizationId' }, links: { $sum: 1 } } },
    { $match: { links: { $gt: 1 } } },
    { $group: { _id: '$organizationId', reports: { $sum: 1 } } },
  ]);

  const byOrg = new Map();
  const entry = (orgId) => {
    const key = String(orgId);
    if (!byOrg.has(key)) byOrg.set(key, { links: [], multiReports: 0 });
    return byOrg.get(key);
  };
  for (const link of links) entry(link.organizationId).links.push(link);
  for (const row of multi) entry(row._id).multiReports = row.reports;

  const orgs = await Organization.find(
    { _id: { $in: [...byOrg.keys()].map((id) => new mongoose.Types.ObjectId(id)) } },
    { name: 1, isInternal: 1, 'deletion.requestedAt': 1 }
  ).lean();
  const rows = [];
  for (const org of orgs) {
    const { links: theirs, multiReports } = byOrg.get(String(org._id));
    const t = tally();
    if (theirs.length) {
      const blocked = await shareLinksBlocked(org._id);
      for (const link of theirs) t[stateOf(link, blocked, now)] += 1;
      t.links = theirs.length;
      t.campaigns = new Set(theirs.map((l) => String(l.campaignId))).size;
    }
    const opened = theirs.map((l) => l.lastAccessedAt).filter(Boolean).map((d) => new Date(d));
    const lastOpened = opened.length ? new Date(Math.max(...opened)) : null;
    rows.push({ org, t, lastOpened, multiReports });
  }
  rows.sort((a, b) => b.t.working - a.t.working || a.org.name.localeCompare(b.org.name));

  const total = { ...tally(), orgs: 0, multiReports: 0, multiOrgs: 0 };
  for (const { org, t, lastOpened, multiReports } of rows) {
    const notes = [org.isInternal ? 'Doorline internal' : null, org.deletion?.requestedAt ? 'being deleted' : null].filter(Boolean);
    console.log(`${org.name}${notes.length ? ` (${notes.join(', ')})` : ''}`);
    if (t.links) {
      console.log(`  ${count(t.links, 'link')} to all your reports: ${statesLine(t)}`);
      console.log(`  on ${count(t.campaigns, 'campaign')} · ${lastOpened ? `last opened ${day(lastOpened)}` : 'never opened'}`);
      total.orgs += 1;
      for (const key of ['links', 'working', 'billing', 'turnedOff', 'expired', 'campaigns']) total[key] += t[key];
    } else {
      console.log('  no links to all your reports');
    }
    if (multiReports) {
      console.log(`  ${count(multiReports, 'report')} with more than one link`);
      total.multiReports += multiReports;
      total.multiOrgs += 1;
    }
    console.log('');
  }

  // Links whose organization is gone can't be named; say how many, so the totals add up.
  const named = new Set(orgs.map((o) => String(o._id)));
  const orphanLinks = [...byOrg.entries()].filter(([id]) => !named.has(id)).reduce((sum, [, e]) => sum + e.links.length, 0);

  console.log(
    total.orgs
      ? `All organizations: ${count(total.orgs, 'organization')} with links to all your reports · ${count(total.links, 'link')}: ${statesLine(total)} · on ${count(total.campaigns, 'campaign')}`
      : 'All organizations: no organization has a link to all your reports.'
  );
  console.log(
    total.multiReports
      ? `${count(total.multiReports, 'report')} with more than one link, in ${count(total.multiOrgs, 'organization')}`
      : 'No report has more than one link.'
  );
  if (orphanLinks) console.log(`Not counted above: ${count(orphanLinks, 'link')} to all your reports in an organization that no longer exists.`);
  console.log('Nothing was changed.');
  await mongoose.disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
