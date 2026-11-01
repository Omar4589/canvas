import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

// The phone-clock check (docs/PROPOSAL_PHONE_CLOCKS.md), run as the OPERATOR runs it: a child process
// over the real script with MONGODB_URI pointed at the throwaway mongod (set explicitly, so the
// script's dotenv never reaches the repo's own .env), plus one run from the repo root through the root
// package.json proxy. Seeds go in through the raw driver with `_id`s minted from each row's createdAt,
// as Mongoose mints them, so --since windows behave as in production. Locks the rule's verdicts on
// the review's cases, the totals-only output (no name, email or id; small groups withheld), and that
// the script writes nothing.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/audit_clock_test node --test test/auditPhoneClocks.int.test.js

const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Organization } = await import('../src/models/Organization.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { User } = await import('../src/models/User.js');
const { zonedDayStr, zonedTimeToUtc } = await import('../src/utils/timezone.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '../src/migrations/auditPhoneClocks.js');
const ROOT = path.resolve(HERE, '../..');
const MODELS = [CanvassActivity, Organization, Campaign, User];

const check = async (...flags) =>
  run(process.execPath, [SCRIPT, ...flags], { env: { ...process.env, MONGODB_URI: URI }, maxBuffer: 4 * 1024 * 1024 });
const failing = async (uri, ...flags) => {
  try {
    await run(process.execPath, [SCRIPT, ...flags], { env: { ...process.env, MONGODB_URI: uri } });
  } catch (e) {
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
  return { code: 0, stdout: '', stderr: '' };
};

const CHI = 'America/Chicago';
const LA = 'America/Los_Angeles';
const NYC = 'America/New_York';
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const TODAY = zonedDayStr(Date.now(), CHI);
const ago = (k) => {
  const [y, m, d] = TODAY.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - k)).toISOString().slice(0, 10);
};
const at = (day, h, mi = 0, s = 0, zone = CHI) => {
  const [y, m, d] = day.split('-').map(Number);
  return zonedTimeToUtc(y, m, d, h, mi, s, zone).getTime();
};
// The script's own date rule: a year only when a range spans two, or a lone day isn't in this one.
const words = (day, year) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) });
const civil = (day) => words(day, day.slice(0, 4) !== TODAY.slice(0, 4));
const civilRange = (a, b) => `${words(a, a.slice(0, 4) !== b.slice(0, 4))} to ${words(b, a.slice(0, 4) !== b.slice(0, 4))}`;
const D3 = ago(3);
const D4 = ago(4);
const D5 = ago(5);
const D6 = ago(6);
const Y = ago(1);
const D40 = ago(40);
const SINCE_D3 = new Date(at(D3, 0)).toISOString();

const oid = () => new mongoose.Types.ObjectId();
const idAt = (ms) => new mongoose.Types.ObjectId(Math.floor(ms / 1000).toString(16).padStart(8, '0') + randomBytes(8).toString('hex'));
const ids = {};

const ORG_NAMES = ['Acme Field Co', 'Beta Canvass', 'Doorline Demo', 'Gone Soon LLC'];
const CAMPAIGN_NAMES = ['Smith for Senate', 'Jones for Mayor', 'Beta Campaign', 'Old Campaign', 'Demo Campaign', 'Gone Campaign'];
const PEOPLE = {
  right: 'Rita Right', behind: 'Ben Behind', ahead: 'Ada Ahead', day: 'Dan Daybehind', late: 'Lou Late', queued: 'Quinn Queue',
  qahead: 'Ava Early', cal: 'Cal Crew', cora: 'Cora Crew', cy: 'Cy Crew', r1: 'Ray One', r2: 'Ray Two', r3: 'Ray Three',
  r4: 'Ray Four', w1: 'Wes One', w2: 'Wes Two', w3: 'Wes Three', w4: 'Wes Four', stall: 'Stu Stall', two: 'Tess Two',
  dst: 'Dee Dst', la: 'Lee Angeles',
};

const save = (o) => ({
  _id: idAt(o.at),
  organizationId: o.org ?? ids.acme,
  campaignId: o.campaign ?? ids.smith,
  householdId: oid(),
  userId: o.user,
  actionType: o.actionType || 'not_home',
  location: { lat: 33.8, lng: -84.4, accuracy: 8 },
  timestamp: 'timestamp' in o ? o.timestamp : new Date(o.at - o.lag),
  ...(o.noCreatedAt ? {} : { createdAt: new Date(o.at) }),
  updatedAt: new Date(o.at),
  wasOfflineSubmission: o.queued === true,
  via: o.via ?? null,
});

const reset = async () => {
  for (const M of MODELS) await M.collection.deleteMany({});
  Object.assign(ids, {
    acme: oid(), beta: oid(), demo: oid(), gone: oid(),
    smith: oid(), jones: oid(), betaCamp: oid(), oldCamp: oid(), demoCamp: oid(), goneCamp: oid(),
    u: Object.fromEntries(Object.keys(PEOPLE).map((k) => [k, oid()])),
  });
  const live = { requestedAt: null };
  await Organization.collection.insertMany([
    { _id: ids.acme, name: ORG_NAMES[0], slug: 'acme-field', timeZone: CHI, isInternal: false, deletion: live },
    { _id: ids.beta, name: ORG_NAMES[1], slug: 'beta-canvass', timeZone: NYC, isInternal: false, deletion: live },
    { _id: ids.demo, name: ORG_NAMES[2], slug: 'doorline-demo', timeZone: CHI, isInternal: true, deletion: live },
    { _id: ids.gone, name: ORG_NAMES[3], slug: 'gone-soon', timeZone: CHI, isInternal: false, deletion: { requestedAt: new Date() } },
  ]);
  await Campaign.collection.insertMany([
    // No zone of its own: the organization's (Chicago) applies.
    { _id: ids.smith, organizationId: ids.acme, name: CAMPAIGN_NAMES[0], deletion: live },
    { _id: ids.jones, organizationId: ids.acme, name: CAMPAIGN_NAMES[1], timeZone: LA, deletion: live },
    { _id: ids.betaCamp, organizationId: ids.beta, name: CAMPAIGN_NAMES[2], deletion: live },
    { _id: ids.oldCamp, organizationId: ids.acme, name: CAMPAIGN_NAMES[3], deletion: { requestedAt: new Date() } },
    { _id: ids.demoCamp, organizationId: ids.demo, name: CAMPAIGN_NAMES[4], deletion: live },
    { _id: ids.goneCamp, organizationId: ids.gone, name: CAMPAIGN_NAMES[5], deletion: live },
  ]);
  await User.collection.insertMany(Object.entries(PEOPLE).map(([k, name]) => ({ _id: ids.u[k], name, email: `${k}.canvasser@example.test` })));
};

// The right phone and the phone 2 hours behind, alone: fewer than 3 canvassers found.
const seedPair = (push) => {
  const { u } = ids;
  [[10, 0, 1], [10, 30, 2], [11, 0, 3], [11, 30, 4], [12, 0, 5], [12, 30, 1]].forEach(([h, m, s]) => push({ user: u.right, at: at(D3, h, m), lag: s * SEC }));
  // One save at 1 am, whose phone time (11 pm) is the day before.
  [[1, 0, 2], [10, 0, 1], [10, 20, 30], [10, 40, 5], [11, 0, 2]].forEach(([h, m, s]) => push({ user: u.behind, at: at(D3, h, m), lag: 2 * HOUR + s * SEC }));
  push({ user: u.behind, at: at(D3, 11, 20), lag: 2 * HOUR + 10 * SEC, actionType: 'survey_submitted' });
  [[10, 0, 3], [10, 30, 4], [11, 0, 3]].forEach(([h, m, s]) => push({ user: u.behind, at: at(Y, h, m), lag: 2 * HOUR + s * SEC }));
};

const seedFull = (push) => {
  const { u } = ids;
  seedPair(push);
  // Beside the right phone: a desk mark, a row put back 40 days on (old _id and createdAt), a row with no
  // createdAt, and one whose phone time can't be read.
  push({ user: u.right, at: at(D3, 13, 0), lag: 0, via: 'bulk' });
  push({ user: u.right, at: at(D40, 10, 0), lag: 2 * SEC });
  push({ user: u.right, at: at(D3, 12, 15), lag: SEC, noCreatedAt: true });
  push({ user: u.right, at: at(D3, 12, 20), lag: SEC, timestamp: 'not a date' });
  // 30 minutes ahead.
  [[13, 0, 0], [13, 15, 2], [13, 30, 1], [13, 45, -1]].forEach(([h, m, s]) => push({ user: u.ahead, at: at(D3, h, m), lag: -(30 * MIN + s * SEC) }));
  // A day behind: every phone time is the day before.
  [[9, 0], [9, 30], [10, 0]].forEach(([h, m]) => push({ user: u.day, at: at(D4, h, m), lag: 24 * HOUR + 10 * SEC }));
  // A right phone whose live saves mostly landed 5–9 minutes late (a median would say "behind").
  [[14, 0, 5 * MIN], [14, 10, 6 * MIN], [14, 20, 7 * MIN], [14, 30, 9 * MIN], [14, 40, 2 * SEC], [14, 50, 1.5 * SEC], [15, 0, 800]].forEach(([h, m, lag]) =>
    push({ user: u.late, at: at(D3, h, m), lag })
  );
  // Only sent later, hours after: not judged.
  [[15, 1], [16, 3], [17, 5], [18, 6]].forEach(([h, hours]) => push({ user: u.queued, at: at(D3, h), lag: hours * HOUR, queued: true }));
  // 20 minutes ahead, only sent later.
  [[16, 0, -20 * MIN], [16, 5, -18 * MIN], [16, 10, -19 * MIN], [17, 0, 3 * HOUR]].forEach(([h, m, lag]) => push({ user: u.qahead, at: at(D3, h, m), lag, queued: true }));
  // A crew of three an hour behind in the same windows, among four right phones: all three found.
  for (const who of [u.cal, u.cora, u.cy]) [[10, 1, 1], [10, 11, 2], [10, 21, 3], [10, 31, 4]].forEach(([h, m, s]) => push({ user: who, at: at(D5, h, m), lag: HOUR + s * SEC }));
  for (const who of [u.r1, u.r2, u.r3, u.r4]) [[10, 2], [10, 12], [10, 22]].forEach(([h, m]) => push({ user: who, at: at(D5, h, m), lag: SEC }));
  // Three of the day's four judged phones 45 minutes behind, within a minute of each other: the warning.
  for (const [who, s] of [[u.w1, 0], [u.w2, 30], [u.w3, 60]]) [[11, 0], [11, 10], [11, 20]].forEach(([h, m]) => push({ user: who, at: at(D6, h, m), lag: 45 * MIN + s * SEC }));
  [[11, 0], [11, 10], [11, 20]].forEach(([h, m]) => push({ user: u.w4, at: at(D6, h, m), lag: SEC }));
  // A 7-minute stall: three late saves released inside one window.
  [[14, 7, 0], [14, 7, 20], [14, 7, 40]].forEach(([h, m, s]) => push({ user: u.stall, at: at(D3, h, m, s), lag: 7 * MIN }));
  // One canvasser in two organizations: counted once.
  [[9, 0], [9, 10], [9, 20]].forEach(([h, m]) => push({ user: u.two, at: at(D3, h, m), lag: SEC }));
  [[9, 0], [9, 10], [9, 20]].forEach(([h, m]) => push({ user: u.two, org: ids.beta, campaign: ids.betaCamp, at: at(D3, h, m, 0, NYC), lag: SEC }));
  // The night daylight saving ended in 2025: 1:30 CDT, 1:30 CST and 11:30 pm CST are one 25-hour Chicago day.
  for (const iso of ['2025-11-02T06:30:00Z', '2025-11-02T07:30:00Z', '2025-11-03T05:30:00Z']) push({ user: u.dst, at: Date.parse(iso), lag: SEC });
  // A Los Angeles campaign: 11 pm and 11:50 pm there are already the next day in Chicago.
  [[10, 0], [23, 0], [23, 50]].forEach(([h, m]) => push({ user: u.la, campaign: ids.jones, at: at(D3, h, m, 0, LA), lag: SEC }));
  // Skipped: the demo organization (late "live" rows, like a demo rebuild), an organization and a campaign being deleted.
  for (let i = 0; i < 10; i += 1) push({ user: u.right, org: ids.demo, campaign: ids.demoCamp, at: at(D3, 9, i), lag: 3 * HOUR });
  for (let i = 0; i < 2; i += 1) push({ user: u.right, org: ids.gone, campaign: ids.goneCamp, at: at(D3, 9, 30 + i), lag: SEC });
  for (let i = 0; i < 2; i += 1) push({ user: u.right, campaign: ids.oldCamp, at: at(D3, 9, 40 + i), lag: SEC });
  // Found: rows whose organization, or campaign, no longer exists.
  push({ user: u.right, org: oid(), at: at(D3, 9, 50), lag: SEC });
  push({ user: u.right, campaign: oid(), at: at(D3, 9, 51), lag: SEC });
};

const seed = async (fill) => {
  await reset();
  const rows = [];
  fill((o) => rows.push(save(o)));
  if (rows.length) await CanvassActivity.collection.insertMany(rows);
};

const lines = (stdout) => stdout.split('\n');
const hasLine = (stdout, text) => assert.ok(lines(stdout).some((l) => l.trim() === text), `expected the line\n  ${text}\nin:\n${stdout}`);

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  // This connection builds the models' indexes in the background; let it finish, so the read-only
  // check below compares the script's effect and nothing else.
  await Promise.all(MODELS.map((M) => M.init()));
});
after(async () => {
  if (!URI) return;
  await mongoose.disconnect();
});

test('the full run: verdicts, totals and what is skipped or found', { skip }, async () => {
  await seed(seedFull);
  const { stdout } = await check();
  assert.match(stdout, /^Phone clocks: every visit received, every customer organization \(Doorline's own left out\)\. Read-only; totals only\./);
  // The DST night is a 2025 day, so the range names both years.
  assert.match(stdout, /Checked 89 visits by 22 canvassers, received Nov 2, 2025 to [A-Z][a-z]{2} \d{1,2}, \d{4}\./);
  hasLine(stdout, "sent live 81 · sent later from the phone's queue 8");
  // 25 canvasser-days: the DST night and the Los Angeles evening are one day each in their own zone.
  hasLine(stdout, 'canvasser-days 25: judged 23 · not judged 2 (nothing close enough to its time to tell)');
  hasLine(stdout, `Phones off by 5 minutes or more: 10 canvassers, on 11 canvasser-days, ${civilRange(D6, Y)}.`);
  hasLine(stdout, 'behind, 5 minutes to under an hour: 3 canvasser-days');
  hasLine(stdout, 'behind, 1 hour to under a day: 5 canvasser-days · looks like a time zone set by hand: 5');
  hasLine(stdout, 'behind, a day or more: 1 canvasser-day');
  hasLine(stdout, 'ahead, 5 minutes to under an hour: 2 canvasser-days');
  hasLine(stdout, 'on their latest day: still wrong in the last 2 days · not seen in the last 2 days');
  hasLine(stdout, 'visits with the wrong time: up to 41, of them 1 survey · on a different day in reports: about 4');
  hasLine(
    stdout,
    `Most phones judged on ${civil(D6)} read off by about the same amount: the server's clock or the stored data is the likelier cause. Check that before acting on it.`
  );
  // The crew's day (3 of 7 judged phones) and every other day raise no warning.
  assert.strictEqual(lines(stdout).filter((l) => l.includes('read off by about the same amount')).length, 1);
  hasLine(stdout, "Skipped: 10 visits in Doorline's own organizations · 4 in organizations or campaigns being deleted · 2 missing a readable time");
  hasLine(stdout, 'Found: 2 visits whose organization or campaign no longer exists (deleting one should have removed them)');
  assert.match(stdout, /\nNothing was changed\.\n$/);
});

test('totals only: no organization, campaign or person name, no email and no id', { skip }, async () => {
  await seed(seedFull);
  const { stdout } = await check();
  for (const name of [...ORG_NAMES, ...CAMPAIGN_NAMES, ...Object.values(PEOPLE)]) assert.ok(!stdout.includes(name), `${name} printed`);
  assert.ok(!stdout.includes('@example.test'), 'an email printed');
  assert.doesNotMatch(stdout, /[a-f0-9]{24}/, 'an id printed');
});

test('fewer than 3 canvassers found: visits, surveys and dates are withheld', { skip }, async () => {
  await seed(seedPair);
  const { stdout } = await check();
  assert.match(stdout, /Checked 15 visits by fewer than 3 canvassers, received /);
  hasLine(stdout, 'canvasser-days 3: judged 3 · not judged 0 (nothing close enough to its time to tell)');
  hasLine(stdout, 'Phones off by 5 minutes or more: fewer than 3 canvassers, on 2 canvasser-days.');
  hasLine(stdout, 'behind, 1 hour to under a day: 2 canvasser-days · looks like a time zone set by hand: 2');
  hasLine(stdout, 'on their latest day: still wrong in the last 2 days');
  hasLine(stdout, 'visits, surveys and dates are withheld when fewer than 3 canvassers are found · some visits land on a different day: yes');
  assert.doesNotMatch(stdout, /visits with the wrong time/);
});

test('--since reads the rows inside its window (createFromTime in seconds) and skips partial first days', { skip }, async () => {
  await seed(seedFull);
  const { stdout } = await check(`--since=${SINCE_D3}`);
  assert.match(stdout, /^Phone clocks: visits received since /);
  // Non-zero: a Date passed to createFromTime would have read nothing.
  assert.match(stdout, /Checked 43 visits by 9 canvassers, received /);
  hasLine(stdout, `Phones off by 5 minutes or more: 3 canvassers, on 4 canvasser-days, ${civilRange(D3, Y)}.`);
  // The New York campaign's day began an hour before the window: its 3 saves are a partial day.
  hasLine(
    stdout,
    "Skipped: 10 visits in Doorline's own organizations · 4 in organizations or campaigns being deleted · 2 missing a readable time · 3 on a day that began before the --since time"
  );
});

test('none found carries its denominator', { skip }, async () => {
  await seed((push) => {
    const { u } = ids;
    for (const who of [u.r1, u.r2, u.r3]) [[10, 0], [10, 10], [10, 20]].forEach(([h, m]) => push({ user: who, at: at(D3, h, m), lag: 2 * SEC }));
  });
  const { stdout } = await check();
  hasLine(stdout, 'Phones off by 5 minutes or more: none, among 3 canvassers judged on 3 canvasser-days.');
  assert.doesNotMatch(stdout, /not a clean result/);
});

test('nothing to judge is never a clean result, and exits 1', { skip }, async () => {
  await seed(() => {});
  const empty = await failing(URI);
  assert.strictEqual(empty.code, 1);
  assert.match(empty.stdout, /No visits to check\./);
  assert.match(empty.stdout, /Nothing could be judged, so this is not a clean result\./);
  await seed((push) => [[15, 1], [16, 3], [17, 5]].forEach(([h, hours]) => push({ user: ids.u.queued, at: at(D3, h), lag: hours * HOUR, queued: true })));
  const unjudged = await failing(URI);
  assert.strictEqual(unjudged.code, 1);
  assert.match(unjudged.stdout, /canvasser-days 1: judged 0 · not judged 1/);
  assert.match(unjudged.stdout, /Nothing could be judged, so this is not a clean result\./);
});

test('bad arguments exit 1 before connecting', async () => {
  const dead = 'mongodb://127.0.0.1:1/never';
  for (const [flags, why] of [
    [['--nope'], /Unknown argument: --nope/],
    [['--since=2026-02-30'], /not a real date/],
    [['--since=2026-10-13T23:45'], /no UTC offset/],
    [['--since=2999-01-01'], /in the future/],
  ]) {
    const r = await failing(dead, ...flags);
    assert.strictEqual(r.code, 1, `${flags} must exit 1`);
    assert.match(r.stderr, why, `${flags}: ${r.stderr}`);
  }
});

test('read-only: no collection, document or index changes', { skip }, async () => {
  await seed(seedFull);
  const state = async () => {
    const db = mongoose.connection.db;
    const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
    const hashes = {};
    for (const name of names) {
      const docs = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
      hashes[name] = createHash('sha256').update(JSON.stringify(docs)).digest('hex');
    }
    const indexes = (await CanvassActivity.collection.indexes()).map((i) => i.name).sort();
    return { names, hashes, indexes };
  };
  const before = await state();
  await check();
  await check(`--since=${SINCE_D3}`);
  assert.deepStrictEqual(await state(), before);
});

test('from the repo root, through the root package.json and its --', { skip }, async () => {
  await seed(seedPair);
  const { stdout } = await run('npm', ['run', '--silent', 'audit:phone-clocks', '--', `--since=${SINCE_D3}`], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.match(stdout, /Phone clocks: visits received since /);
  assert.match(stdout, /Checked 15 visits by fewer than 3 canvassers/);
  assert.match(stdout, /Nothing was changed\./);
});
