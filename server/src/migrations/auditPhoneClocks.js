import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { parseSince } from '../utils/sinceArg.js';
import { zonedDayStr, zonedDayRange } from '../utils/timezone.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { Organization } from '../models/Organization.js';
import { Campaign } from '../models/Campaign.js';
import {
  WINDOW_MS,
  judgeDay,
  isWrong,
  sizeBucket,
  looksLikeZone,
  small,
  shiftedDays,
  latestDayState,
  sameOffsetDays,
} from '../services/audit/phoneClock.js';

// Phones with a wrong clock (docs/PROPOSAL_PHONE_CLOCKS.md; gap G5 of PROPOSAL_RECENT_VISITS.md).
// READ-ONLY — it never writes. Compares each visit's phone time with the moment the server received it
// and judges each canvasser one day at a time (the rule is services/audit/phoneClock.js).
//
//   npm run audit:phone-clocks                                     # every visit
//   npm run audit:phone-clocks -- --since=2026-11-02T00:00-06:00   # visits received at or after that instant
//
// Any time from the repo root (Heroku dashboard → More → Run console); the full run reads every visit
// once, so run it outside field hours. TOTALS ONLY, across every customer organization: it reads no name
// at all — organizations and campaigns by id, time zone and deletion flag only — and prints no
// organization, campaign, person or id. Counts of people under 3 print "fewer than 3", and with fewer
// than 3 canvassers found it withholds visit counts and dates, which staff could match to a member's
// own figures (docs/PRIVACY_VERIFICATION.md). Internal organizations (the demo) and organizations or
// campaigns being deleted are skipped.

const OWNER_TIME_ZONE = 'America/Chicago';
const FALLBACK_ZONE = 'America/New_York';

const args = process.argv.slice(2);
const unknown = args.filter((a) => !a.startsWith('--since='));
if (unknown.length) {
  console.error(`Unknown argument: ${unknown.join(' ')}\nUsage: npm run audit:phone-clocks [-- --since=<YYYY-MM-DD | YYYY-MM-DDTHH:MM±HH:MM>]`);
  process.exit(1);
}
const sinceArg = args.find((a) => a.startsWith('--since='));
let since = null;
if (sinceArg) {
  const parsed = parseSince(sinceArg.slice('--since='.length));
  if (parsed.error) {
    console.error(parsed.error);
    process.exit(1);
  }
  since = parsed.at;
}

// The campaign's zone, else its organization's, else New York (the resolver's order); a zone Intl
// rejects falls through to the next instead of stopping the run.
const zoneChecked = new Map();
const zoneOk = (zone) => {
  if (!zone) return false;
  if (!zoneChecked.has(zone)) {
    try {
      zonedDayStr(0, zone);
      zoneChecked.set(zone, true);
    } catch {
      zoneChecked.set(zone, false);
    }
  }
  return zoneChecked.get(zone);
};
const zoneOf = (campaign, org) => [campaign.timeZone, org.timeZone, FALLBACK_ZONE].find(zoneOk);

const dayStarts = new Map();
const dayStart = (day, zone) => {
  const key = `${zone}|${day}`;
  if (!dayStarts.has(key)) dayStarts.set(key, zonedDayRange(day, null, zone).$gte.getTime());
  return dayStarts.get(key);
};

const n = (x) => x.toLocaleString('en-US');
const cdays = (k) => `${n(k)} canvasser-day${k === 1 ? '' : 's'}`;
// Dates carry their year only when a range spans two years, or a lone day isn't in this one.
const dateWords = (date, zone, year) => date.toLocaleDateString('en-US', { timeZone: zone, month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) });
const yearIn = (date, zone) => date.toLocaleDateString('en-US', { timeZone: zone, year: 'numeric' });
const noonOf = (day) => new Date(`${day}T12:00:00Z`);
const centralRange = (a, b) => {
  const [from, to] = [new Date(a), new Date(b)];
  const year = yearIn(from, OWNER_TIME_ZONE) !== yearIn(to, OWNER_TIME_ZONE);
  return `${dateWords(from, OWNER_TIME_ZONE, year)} to ${dateWords(to, OWNER_TIME_ZONE, year)}`;
};
const civilRange = (a, b) => {
  const year = a.slice(0, 4) !== b.slice(0, 4);
  return `${dateWords(noonOf(a), 'UTC', year)} to ${dateWords(noonOf(b), 'UTC', year)}`;
};
const civilDay = (day, now) => dateWords(noonOf(day), 'UTC', day.slice(0, 4) !== yearIn(now, OWNER_TIME_ZONE));
const centralTime = (d) =>
  d.toLocaleString('en-US', { timeZone: OWNER_TIME_ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

const BUCKET_WORDS = { minutes: '5 minutes to under an hour', hours: '1 hour to under a day', days: 'a day or more' };
const STATE_WORDS = { wrong: 'still wrong in the last 2 days', right: 'right on their latest day', unseen: 'not seen in the last 2 days', unjudged: 'latest day not judged' };

const main = async () => {
  // Read-only on every database: outside production connectDb turns autoIndex on, which would build
  // every imported model's indexes, and autoCreate alone would still create each one's collection.
  await connectDb(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
  const now = new Date();
  const orgs = new Map(
    (await Organization.find({}, '_id isInternal timeZone deletion.requestedAt').lean()).map((o) => [String(o._id), o])
  );
  const campaigns = new Map(
    (await Campaign.find({}, '_id organizationId timeZone deletion.requestedAt').lean()).map((c) => [String(c._id), c])
  );

  const t = { rows: 0, live: 0, queued: 0, internal: 0, deleting: 0, missing: 0, gone: 0, partial: 0, first: Infinity, last: -Infinity };
  const canvassers = new Set();
  const groups = new Map(); // `${org}|${campaign}|${user}|${day}` → one canvasser-day
  const filter = {
    via: { $ne: 'bulk' },
    // createFromTime takes SECONDS: a Date wraps to a random year and the window reads nothing.
    ...(since ? { _id: { $gte: mongoose.Types.ObjectId.createFromTime(Math.floor(since.getTime() / 1000)) } } : {}),
  };
  const cursor = CanvassActivity.find(filter, 'organizationId campaignId userId actionType timestamp createdAt wasOfflineSubmission')
    .lean()
    .cursor();
  for await (const row of cursor) {
    const org = orgs.get(String(row.organizationId));
    const campaign = campaigns.get(String(row.campaignId));
    if (!org || !campaign) {
      t.gone += 1;
      continue;
    }
    if (org.isInternal) {
      t.internal += 1;
      continue;
    }
    if (org.deletion?.requestedAt || campaign.deletion?.requestedAt) {
      t.deleting += 1;
      continue;
    }
    const phoneAt = row.timestamp instanceof Date ? row.timestamp.getTime() : NaN;
    const receivedAt = row.createdAt instanceof Date ? row.createdAt.getTime() : NaN;
    if (!Number.isFinite(phoneAt) || !Number.isFinite(receivedAt)) {
      t.missing += 1;
      continue;
    }
    const zone = zoneOf(campaign, org);
    const day = zonedDayStr(receivedAt, zone);
    const start = dayStart(day, zone);
    // A day that began before --since holds only part of that day: not judged, counted.
    if (since && start < since.getTime()) {
      t.partial += 1;
      continue;
    }
    const user = String(row.userId);
    const live = !row.wasOfflineSubmission;
    t.rows += 1;
    t[live ? 'live' : 'queued'] += 1;
    t.first = Math.min(t.first, receivedAt);
    t.last = Math.max(t.last, receivedAt);
    canvassers.add(user);
    const key = `${row.organizationId}|${row.campaignId}|${user}|${day}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { user, day, zone, start, saves: [], times: [], surveys: 0 }));
    g.saves.push({ lag: receivedAt - phoneAt, live, window: Math.floor(receivedAt / WINDOW_MS) });
    g.times.push(phoneAt);
    if (row.actionType === 'survey_submitted') g.surveys += 1;
  }

  console.log(
    `Phone clocks: ${since ? `visits received since ${centralTime(since)}` : 'every visit received'}, every customer organization (Doorline's own left out). Read-only; totals only.\n`
  );

  let judgedDays = 0;
  const judgedCanvassers = new Set();
  const judgedByDay = new Map();
  const daysByUser = new Map();
  const flagged = [];
  for (const g of groups.values()) {
    const { verdict, sizeMs } = judgeDay(g.saves);
    if (!daysByUser.has(g.user)) daysByUser.set(g.user, []);
    daysByUser.get(g.user).push({ day: g.day, zone: g.zone, start: g.start, verdict });
    if (verdict === 'unjudged') continue;
    judgedDays += 1;
    judgedCanvassers.add(g.user);
    if (!judgedByDay.has(g.day)) judgedByDay.set(g.day, new Set());
    judgedByDay.get(g.day).add(g.user);
    if (isWrong(verdict)) {
      flagged.push({
        user: g.user,
        day: g.day,
        verdict,
        sizeMs,
        visits: g.saves.length,
        surveys: g.surveys,
        shifted: shiftedDays(g.times, sizeMs, verdict, g.zone),
      });
    }
  }

  if (t.rows) {
    console.log(`Checked ${n(t.rows)} visits by ${small(canvassers.size)} canvassers, received ${centralRange(t.first, t.last)}.`);
    console.log(`  sent live ${n(t.live)} · sent later from the phone's queue ${n(t.queued)}`);
    console.log(
      `  canvasser-days ${n(groups.size)}: judged ${n(judgedDays)} · not judged ${n(groups.size - judgedDays)} (nothing close enough to its time to tell)\n`
    );
  } else {
    console.log('No visits to check.\n');
  }

  if (!judgedDays) {
    console.log('Nothing could be judged, so this is not a clean result.\n');
  } else if (!flagged.length) {
    console.log(`Phones off by 5 minutes or more: none, among ${small(judgedCanvassers.size)} canvassers judged on ${cdays(judgedDays)}.`);
    if (judgedDays * 2 < groups.size) console.log('  Fewer than half the canvasser-days could be judged, so "none" is not a clean result.');
    console.log('');
  } else {
    const found = new Set(flagged.map((f) => f.user));
    const enough = found.size >= 3;
    const days = flagged.map((f) => f.day).sort();
    console.log(
      `Phones off by 5 minutes or more: ${small(found.size)} canvassers, on ${cdays(flagged.length)}${enough ? `, ${civilRange(days[0], days[days.length - 1])}` : ''}.`
    );
    for (const verdict of ['behind', 'ahead']) {
      for (const bucket of ['minutes', 'hours', 'days']) {
        const these = flagged.filter((f) => f.verdict === verdict && sizeBucket(f.sizeMs) === bucket);
        if (!these.length) continue;
        const zoned = these.filter((f) => looksLikeZone(f.sizeMs)).length;
        console.log(`  ${verdict}, ${BUCKET_WORDS[bucket]}: ${cdays(these.length)}${zoned ? ` · looks like a time zone set by hand: ${n(zoned)}` : ''}`);
      }
    }
    // Which states occur, never how many: a count under 3 could be worked out from the total.
    const states = new Set([...found].map((user) => latestDayState(daysByUser.get(user), now)));
    console.log(`  on their latest day: ${['wrong', 'right', 'unseen', 'unjudged'].filter((s) => states.has(s)).map((s) => STATE_WORDS[s]).join(' · ')}`);
    const shifted = flagged.reduce((sum, f) => sum + f.shifted, 0);
    if (enough) {
      const visits = flagged.reduce((sum, f) => sum + f.visits, 0);
      const surveys = flagged.reduce((sum, f) => sum + f.surveys, 0);
      console.log(`  visits with the wrong time: up to ${n(visits)}, of them ${n(surveys)} survey${surveys === 1 ? '' : 's'} · on a different day in reports: about ${n(shifted)}`);
    } else {
      console.log(`  visits, surveys and dates are withheld when fewer than 3 canvassers are found · some visits land on a different day: ${shifted ? 'yes' : 'no'}`);
    }
    for (const day of sameOffsetDays(flagged, judgedByDay)) {
      console.log(`  Most phones judged on ${civilDay(day, now)} read off by about the same amount: the server's clock or the stored data is the likelier cause. Check that before acting on it.`);
    }
    console.log('');
  }

  console.log(
    `Skipped: ${n(t.internal)} visits in Doorline's own organizations · ${n(t.deleting)} in organizations or campaigns being deleted · ${n(t.missing)} missing a readable time${since ? ` · ${n(t.partial)} on a day that began before the --since time` : ''}`
  );
  console.log(`Found: ${n(t.gone)} visits whose organization or campaign no longer exists${t.gone ? ' (deleting one should have removed them)' : ''}\n`);
  console.log('Nothing was changed.');
  await mongoose.disconnect();
  if (!judgedDays) process.exitCode = 1;
};

main().catch((e) => {
  console.error('The phone clock check stopped before it finished. Nothing was changed.');
  console.error(e);
  process.exit(1);
});
