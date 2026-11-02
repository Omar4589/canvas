import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { parseSince } from '../utils/sinceArg.js';
import { ImportJob } from '../models/ImportJob.js';
import { Organization } from '../models/Organization.js';
import { summarizeImportTimes, formatDuration } from '../services/site/setupTimes.js';

// How long voter-file imports take in production — the evidence behind the homepage's "often the same
// day" (docs/PROPOSAL_AAPC_LANDING.md, decision 5; the rule is services/site/setupTimes.js).
// READ-ONLY — it never writes.
//
//   npm run report:setup-times                          # every completed import
//   npm run report:setup-times -- --since=2026-09-01    # imports uploaded at or after that day (Central)
//
// From the repo root (Heroku dashboard → More → Run console). TOTALS ONLY, across customer organizations:
// internal and demo organizations are left out, and it reads only each import's row count and its three
// clock fields — no file name, no organization, campaign or person, so it prints none. Turf cuts aren't
// in it: their timing lives in the job queue for 7 days only.
const sinceArg = process.argv.find((a) => a.startsWith('--since='))?.slice('--since='.length);

async function main() {
  const since = sinceArg ? parseSince(sinceArg) : null;
  await connectDb(process.env.MONGODB_URI);
  const internal = await Organization.find({ isInternal: true }, '_id').lean();
  const rows = await ImportJob.find(
    {
      kind: 'apply',
      status: 'completed',
      organizationId: { $nin: internal.map((o) => o._id) },
      ...(since ? { createdAt: { $gte: since } } : {}),
    },
    'totalRows createdAt startedAt completedAt'
  ).lean();
  const { total, largest, buckets } = summarizeImportTimes(rows);

  console.log('Voter-file imports, customer organizations only (internal and demo organizations left out)');
  console.log(`Completed imports${since ? ` since ${since.toISOString()}` : ''}: ${total}`);
  console.log('');
  console.log('Rows                  Imports   Upload to ready (median · slowest)   Processing (median · slowest)');
  for (const b of buckets) {
    const wait = b.count ? `${formatDuration(b.waitMedian)} · ${formatDuration(b.waitMax)}` : '—';
    const run = b.count ? `${formatDuration(b.runMedian)} · ${formatDuration(b.runMax)}` : '—';
    console.log(`${b.label.padEnd(22)}${String(b.count).padStart(7)}   ${wait.padEnd(37)}${run}`);
  }
  console.log('');
  if (largest) console.log(`Largest import: ${largest.rows.toLocaleString('en-US')} rows, ready ${formatDuration(largest.wait)} after upload.`);
  console.log('Nothing was written. No names, organizations or campaigns were read or printed.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
