import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Door counts to FbTime — the door step (services/fbtime/doorPush.js) over a real database
// and the in-process FbTime board (test/support/fbtimeFake.js), which models FbTime's
// window-replace, "Doorline decides", the explicit-clear restore and the emptied-day marker.
//
//   · PARITY: what FbTime receives per person per day equals the Timeline's Doors column,
//     summed across the org's campaigns — campaign zones, a Honolulu date flip, the DST end,
//     window edges, every actionType, desk marks, notes, an archived campaign, another org.
//   · Run order, the per-request gate, the reporter predicate, every class of answer.
//   · Explicit clears (flagged restoreTyped, group progress, the confirm pass) and kept accounts.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/doorpush node --test test/fbtimeDoorPush.int.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-fbtime-doors';
process.env.CREDENTIAL_SEAL_KEY = process.env.CREDENTIAL_SEAL_KEY || Buffer.alloc(32, 5).toString('base64');
process.env.FBTIME_DOOR_COUNTS = 'on';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { FbTimeConnection } = await import('../src/models/FbTimeConnection.js');
const { FbTimePersonLink } = await import('../src/models/FbTimePersonLink.js');
const { FbTimeShift } = await import('../src/models/FbTimeShift.js');
const { IntegrationEvent } = await import('../src/models/IntegrationEvent.js');
const { sealSecret } = await import('../src/utils/sealedSecret.js');
const { FbtimeApiError } = await import('../src/services/fbtime/client.js');
const { runDoorStep } = await import('../src/services/fbtime/doorPush.js');
const { syncOneConnection } = await import('../src/services/fbtime/sync.js');
const { processMaintenanceJob } = await import('../src/services/retention/scheduler.js');
const { installFbtimeFake, uninstallFbtimeFake, fbtimeCalls, fbtimeBoard, doorsPing } = await import('./support/fbtimeFake.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

// Mon 2026-11-02 10:00 in New York (EST — the clocks went back on Sunday). The 120-day
// window ends 2026-11-02 and starts 2026-07-06.
const NOW = new Date('2026-11-02T15:00:00Z');
const START = '2026-07-06';
const END = '2026-11-02';
const FB_ORG = 'f0000000000000000000000d';
const P1 = 'cccccccccccccccccccccc01';
const P2 = 'cccccccccccccccccccccc02';
const P3 = 'cccccccccccccccccccccc03';
const P9 = 'cccccccccccccccccccccc09';
const DOOR_SCOPES = ['timesheets:read', 'roster:read', 'doors:write'];

const ctx = {};
let server;
let base;

const addDays = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const minutes = (d, m) => new Date(new Date(d).getTime() + m * 60_000);

const knock = (o) =>
  CanvassActivity.create({
    organizationId: o.org || ctx.org._id,
    campaignId: o.campaign._id,
    householdId: new mongoose.Types.ObjectId(),
    userId: o.user,
    actionType: o.type || 'not_home',
    timestamp: new Date(o.at),
    location: { lat: 28.3, lng: -81.4 },
    via: o.via ?? null,
  });

const connect = (overrides = {}, doors = {}) =>
  FbTimeConnection.create({
    organizationId: ctx.org._id,
    status: 'connected',
    keyCiphertext: sealSecret('fbt_test_doorskey01'),
    keyPrefix: 'fbt_test_doo',
    fbtimeOrgId: FB_ORG,
    fbtimeOrgName: 'Fake FbTime Org',
    keyScopes: DOOR_SCOPES,
    fbtimeFeatures: ['doors:reported-wins'],
    doors: { enabled: true, enabledAt: new Date(), ...doors },
    ...overrides,
  });

const link = (userId, fbtimePersonId) =>
  FbTimePersonLink.create({ organizationId: ctx.org._id, userId, fbtimePersonId, source: 'manual' });

const conn = () => FbTimeConnection.findOne({ organizationId: ctx.org._id }).lean();
const puts = () => fbtimeCalls().filter((c) => c.path === '/doors' && c.method === 'PUT');
const events = (type) => IntegrationEvent.find({ organizationId: ctx.org._id, ...(type ? { type } : {}) }).lean();
const fake = (config = {}) => installFbtimeFake({ ping: doorsPing(FB_ORG), now: NOW, ...config });
const run = (id, opts = {}) => runDoorStep(id, { now: NOW, ...opts });

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, Subscription, User, Membership, Campaign, CanvassActivity, FbTimeConnection,
    FbTimePersonLink, FbTimeShift, IntegrationEvent]) {
    await M.deleteMany({});
  }
  const org = await Organization.create({ name: 'Doors Org', slug: 'doors-org', isActive: true, timeZone: 'America/New_York' });
  const org2 = await Organization.create({ name: 'Elsewhere', slug: 'doors-elsewhere', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const mk = (first) => User.create({ firstName: first, lastName: 'D', email: `${first.toLowerCase()}@doors.co`, passwordHash: 'x', isActive: true });
  const [admin, u1, u2, u3, u4] = await Promise.all(['Ada', 'Maria', 'Nia', 'Omar', 'Pat'].map(mk));
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  for (const u of [u1, u2, u3, u4]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });

  const camp = (name, timeZone, extra = {}) => Campaign.create({ organizationId: org._id, name, type: 'survey', state: 'FL', timeZone, ...extra });
  const chi = await camp('Chicago Doors', 'America/Chicago');
  const nyc = await camp('Old NYC', 'America/New_York', { isActive: false, archivedAt: new Date('2026-10-30T00:00:00Z') });
  const hnl = await camp('Honolulu', 'Pacific/Honolulu');
  const other = await Campaign.create({ organizationId: org2._id, name: 'Other org', type: 'survey', state: 'FL', timeZone: 'America/New_York' });
  Object.assign(ctx, { org, org2, admin, u1, u2, u3, u4, chi, nyc, hnl, other, adminToken: signUserToken(admin) });

  // ── The parity fixture: Maria (P1), Nia (P2), Omar (P3, linked, no knocks), Pat (unlinked).
  // Oct 19: a Chicago 23:30 knock (Oct 20 in New York) + a New York 21:00 knock → 2 on Oct 19.
  await knock({ campaign: chi, user: u1._id, at: '2026-10-20T04:30:00Z' });
  await knock({ campaign: nyc, user: u1._id, at: '2026-10-20T01:00:00Z' });
  // Honolulu 22:00 on Oct 24 is Oct 25 in New York — filed under the campaign's Oct 24.
  await knock({ campaign: hnl, user: u1._id, at: '2026-10-25T08:00:00Z', type: 'survey_submitted' });
  // 23:30 on Nov 1, the night the clocks went back.
  await knock({ campaign: nyc, user: u1._id, at: '2026-11-02T04:30:00Z', type: 'refused' });
  // A Restricted-access-only day travels as 0; a note and desk marks make no day at all.
  await knock({ campaign: chi, user: u1._id, at: '2026-10-15T15:00:00Z', type: 'restricted' });
  await knock({ campaign: chi, user: u1._id, at: '2026-10-16T15:00:00Z', type: 'note_added' });
  await knock({ campaign: chi, user: u1._id, at: '2026-10-17T15:00:00Z', type: 'restricted', via: 'bulk' });
  await knock({ campaign: chi, user: u1._id, at: '2026-10-17T16:00:00Z', type: 'not_home', via: 'bulk' });
  // Every knock actionType on Oct 10 (7), plus a restricted mark that adds nothing.
  const types = ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped', 'no_soliciting', 'not_target', 'restricted'];
  for (const [i, type] of types.entries()) await knock({ campaign: chi, user: u1._id, at: minutes('2026-10-10T15:00:00Z', i), type });
  // Window edges: 00:05 on the first day counts; 23:55 the night before (New York) and
  // 23:30 the night before (Chicago — inside the union window's UTC range) do not.
  await knock({ campaign: nyc, user: u1._id, at: '2026-07-06T04:05:00Z' });
  await knock({ campaign: nyc, user: u1._id, at: '2026-07-06T03:55:00Z' });
  await knock({ campaign: chi, user: u1._id, at: '2026-07-06T04:30:00Z' });
  // Maria's work in ANOTHER organization never reaches this one's FbTime.
  await knock({ org: org2._id, campaign: other, user: u1._id, at: '2026-10-19T15:00:00Z' });
  await knock({ campaign: nyc, user: u2._id, at: '2026-10-30T15:00:00Z', type: 'survey_submitted' });
  await knock({ campaign: chi, user: u4._id, at: '2026-10-19T15:00:00Z' }); // unlinked: never sent

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  uninstallFbtimeFake();
  delete process.env.FBTIME_DOOR_COUNTS;
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

beforeEach(async () => {
  if (!URI) return;
  uninstallFbtimeFake();
  process.env.FBTIME_DOOR_COUNTS = 'on';
  for (const M of [FbTimeConnection, FbTimePersonLink, FbTimeShift, IntegrationEvent]) await M.deleteMany({});
  await Organization.updateOne({ _id: ctx.org._id }, { $unset: { deletion: '' } });
});

const timelineCells = async (campaigns, from, to) => {
  const out = new Map();
  for (const c of campaigns) {
    for (let s = from; s <= to; s = addDays(s, 60)) {
      const e = addDays(s, 59) < to ? addDays(s, 59) : to;
      const res = await fetch(`${base}/api/admin/reports/canvasser-timeline?campaignId=${c._id}&from=${s}&to=${e}`, {
        headers: { Authorization: `Bearer ${ctx.adminToken}`, 'X-Org-Id': String(ctx.org._id) },
      });
      assert.strictEqual(res.status, 200, 'the Timeline answered');
      const json = await res.json();
      for (const row of json.canvassers) {
        for (const [day, n] of Object.entries(row.knocksByDay || {})) {
          const key = `${row.userId}|${day}`;
          out.set(key, (out.get(key) || 0) + n);
        }
      }
    }
  }
  return out;
};

test('PARITY: FbTime receives exactly the Timeline’s Doors per canvasser per day, summed across campaigns', { skip }, async () => {
  const c = await connect();
  await link(ctx.u1._id, P1);
  await link(ctx.u2._id, P2);
  await link(ctx.u3._id, P3);
  fake();
  const res = await run(c._id, { deep: true });
  assert.strictEqual(res.ok, true, JSON.stringify(res));

  // One 120-day request listing everyone linked — Omar too, with no days.
  const sent = puts();
  assert.strictEqual(sent.length, 1);
  assert.deepStrictEqual(sent[0].body.userIds, [P1, P2, P3]);
  assert.strictEqual(sent[0].body.startDate, START);
  assert.strictEqual(sent[0].body.endDate, END);
  assert.deepStrictEqual(Object.keys(sent[0].body).sort(), ['counts', 'endDate', 'startDate', 'userIds']);

  const board = fbtimeBoard().reported();
  const timeline = await timelineCells([ctx.chi, ctx.nyc, ctx.hnl], START, END);
  const personOf = { [String(ctx.u1._id)]: P1, [String(ctx.u2._id)]: P2, [String(ctx.u3._id)]: P3 };
  for (const [uid, pid] of Object.entries(personOf)) {
    for (let d = START; d <= END; d = addDays(d, 1)) {
      assert.strictEqual(board[`${pid}|${d}`] ?? 0, timeline.get(`${uid}|${d}`) || 0, `${pid} on ${d}`);
    }
  }
  for (const key of Object.keys(board)) assert.ok([P1, P2, P3].includes(key.split('|')[0]), 'only linked people');

  // The cases by name.
  assert.strictEqual(board[`${P1}|2026-10-19`], 2, 'Chicago 23:30 + New York 21:00, one date, added together');
  assert.strictEqual(board[`${P1}|2026-10-20`], undefined, 'never filed under New York’s date');
  assert.strictEqual(board[`${P1}|2026-10-24`], 1, 'the Honolulu campaign’s own date');
  assert.strictEqual(board[`${P1}|2026-11-01`], 1, 'the night the clocks went back');
  assert.strictEqual(board[`${P1}|2026-10-15`], 0, 'a Restricted-only day is sent as 0');
  assert.strictEqual(board[`${P1}|2026-10-16`], undefined, 'a note makes no day');
  assert.strictEqual(board[`${P1}|2026-10-17`], undefined, 'desk marks make no day');
  assert.strictEqual(board[`${P1}|2026-10-10`], 7, 'every knock actionType counts once; restricted never');
  assert.strictEqual(board[`${P1}|${START}`], 1, '00:05 on the first day');
  assert.strictEqual(board[`${P1}|2026-07-05`], undefined, 'nothing before the window');
  assert.strictEqual(board[`${P2}|2026-10-30`], 1);
  assert.ok(!Object.keys(board).some((k) => k.startsWith(`${P3}|`)), 'linked with no knocks: listed, nothing sent');

  const after = await conn();
  assert.deepStrictEqual(after.doors.reported, [P1, P2, P3], 'the write-ahead ledger');
  assert.strictEqual(after.doors.earliestDate, START);
  assert.strictEqual(after.doors.lastResult[0].people, 3);
  assert.ok(after.doors.lastDeepSentAt, 'a full run records its deep result');
});

test('a door recorded again moves to the later day, and a day that empties is cleared (and marked)', { skip }, async () => {
  const c = await connect();
  await link(ctx.u2._id, P2);
  // Inside the 7-day window (Oct 27 – Nov 2), so the 15-minute run carries the move.
  const moved = await knock({ campaign: ctx.chi, user: ctx.u2._id, at: '2026-10-28T15:00:00Z' });
  try {
    fake();
    await run(c._id, { deep: true });
    assert.strictEqual(fbtimeBoard().shown(P2, '2026-10-28'), 1);
    // The same door, re-recorded on Saturday in the same round: the ledger keeps the latest.
    await CanvassActivity.updateOne({ _id: moved._id }, { $set: { timestamp: new Date('2026-10-31T15:00:00Z') } });
    await run(c._id, { deep: false });
    const cell = fbtimeBoard().cell(P2, '2026-10-28');
    assert.strictEqual(cell.reportedDoors, null);
    assert.strictEqual(cell.emptied, true, 'FbTime marks it "Doorline: none", not "needs doors"');
    assert.strictEqual(fbtimeBoard().shown(P2, '2026-10-31'), 1);
  } finally {
    await CanvassActivity.deleteOne({ _id: moved._id });
  }
});

test('a regular run sends the last 7 days; deepDueAt or the deep job sends 120', { skip }, async () => {
  const c = await connect();
  await link(ctx.u1._id, P1);
  fake();
  await run(c._id, { deep: false });
  assert.strictEqual(puts()[0].body.startDate, addDays(END, -6));
  await FbTimeConnection.updateOne({ _id: c._id }, { $set: { 'doors.deepDueAt': new Date() } });
  await run(c._id, { deep: false });
  assert.strictEqual(puts()[1].body.startDate, START, 'a link change asked for a full run');
  assert.strictEqual((await conn()).doors.deepDueAt, undefined, 'and the full run discharged it');
});

test('nobody linked: no count, no request, "sending" for 0 people — never stuck', { skip }, async () => {
  const c = await connect();
  fake();
  const res = await run(c._id, { deep: true });
  assert.strictEqual(puts().length, 0);
  assert.strictEqual(res.ok, true);
  const doors = (await conn()).doors;
  assert.strictEqual(doors.lastResult[0].people, 0);
  assert.strictEqual(doors.failCode, undefined);
  assert.strictEqual(doors.transientStreak, undefined);
});

test('the door step runs after a FAILING hours pull — and through the one-off org job', { skip }, async () => {
  const c = await FbTimeConnection.findById((await connect())._id);
  await link(ctx.u2._id, P2);
  const recent = await knock({ campaign: ctx.chi, user: ctx.u2._id, at: new Date(Date.now() - 86_400_000) });
  try {
    installFbtimeFake({
      ping: doorsPing(FB_ORG),
      shifts: () => {
        throw new FbtimeApiError('FbTime is having a moment', { status: 503 });
      },
    });
    const res = await syncOneConnection(c, { windowDays: 120, deep: true });
    assert.strictEqual(res.ok, false, 'the hours pull failed');
    assert.strictEqual(puts().length, 1, 'door counts still went');
    assert.ok(puts()[0].body.counts.some((x) => x.userId === P2));
  } finally {
    await CanvassActivity.deleteOne({ _id: recent._id });
  }
});

test('the one-off org job (connect, turn-on, a clear, Sync now) is a deep run: 120 days', { skip }, async () => {
  await connect();
  await link(ctx.u2._id, P2);
  installFbtimeFake({ ping: doorsPing(FB_ORG), shifts: [] });
  await processMaintenanceJob({ name: 'fbtime-hours-org', data: { organizationId: String(ctx.org._id) } });
  const [put] = puts();
  assert.ok(put, 'door counts went');
  const span = (Date.parse(`${put.body.endDate}T00:00:00Z`) - Date.parse(`${put.body.startDate}T00:00:00Z`)) / 86_400_000 + 1;
  assert.strictEqual(span, 120);
  assert.ok((await conn()).doors.lastDeepSentAt);
});

test('a campaign zone MongoDB cannot use never blocks a waiting clear — clears need no count', { skip }, async () => {
  const c = await connect({}, { enabled: false, reported: [P1], earliestDate: '2026-08-01', clearAll: true });
  await Campaign.updateOne({ _id: ctx.hnl._id }, { $set: { timeZone: 'us/hawaii' } });
  try {
    fake();
    await run(c._id);
    assert.strictEqual(puts().length, 1);
    assert.strictEqual(puts()[0].body.restoreTyped, true);
    assert.ok((await conn()).doors.clearAllConfirmAfter, 'the clear-all pass finished');
  } finally {
    await Campaign.updateOne({ _id: ctx.hnl._id }, { $set: { timeZone: 'Pacific/Honolulu' } });
  }
});

test('the per-request gate: a key replaced mid-run sends nothing more and writes nothing onto the new key', { skip }, async () => {
  const c = await connect();
  const ids = Array.from({ length: 42 }, (_, i) => `cdcdcdcdcdcdcdcdcdcd${String(i).padStart(4, '0')}`);
  for (const p of ids) await link(new mongoose.Types.ObjectId(), p);
  fake({
    doorsAfter: async ({ call }) => {
      if (call === 1) {
        await FbTimeConnection.updateOne(
          { _id: c._id },
          { $set: { keyCiphertext: sealSecret('fbt_test_otherorgkey9'), fbtimeOrgId: 'f00000000000000000000099' }, $unset: { doors: '' } }
        );
      }
    },
  });
  await run(c._id, { deep: true });
  assert.strictEqual(puts().length, 1, 'the next request never went');
  assert.strictEqual((await conn()).doors, undefined, 'nothing of the old run landed on the new connection');
});

test('gates: the var off (no write for an org with nothing to do), FbTime outdated, a key that reads hours only', { skip }, async () => {
  const idle = await connect({}, { enabled: false });
  await link(ctx.u1._id, P1);
  fake();
  delete process.env.FBTIME_DOOR_COUNTS;
  const before0 = await conn();
  assert.deepStrictEqual(await run(idle._id), { skipped: 'nothing' });
  assert.deepStrictEqual(await conn(), before0, 'an org that never uses door counts is never written');

  await FbTimeConnection.updateOne({ _id: idle._id }, { $set: { 'doors.enabled': true } });
  assert.deepStrictEqual(await run(idle._id), { skipped: 'unavailable' });
  assert.strictEqual((await conn()).doors.lastSkip, 'unavailable');
  process.env.FBTIME_DOOR_COUNTS = 'on';

  await FbTimeConnection.updateOne({ _id: idle._id }, { $set: { fbtimeFeatures: ['doors:keep-typed'] } });
  assert.deepStrictEqual(await run(idle._id), { skipped: 'fbtime-outdated' });

  await FbTimeConnection.updateOne({ _id: idle._id }, { $set: { fbtimeFeatures: ['doors:reported-wins'], keyScopes: ['timesheets:read'] } });
  await run(idle._id);
  await run(idle._id);
  assert.strictEqual((await conn()).doors.failCode, 'SCOPE_REQUIRED');
  assert.strictEqual((await events('doors-failed')).length, 1, 'written once per transition');
  assert.strictEqual(puts().length, 0, 'nothing was ever sent');

  await Organization.updateOne({ _id: ctx.org._id }, { $set: { 'deletion.requestedAt': new Date() } });
  await FbTimeConnection.updateOne({ _id: idle._id }, { $set: { keyScopes: DOOR_SCOPES } });
  assert.deepStrictEqual(await run(idle._id), { skipped: 'org-deleting' });
});

test('the reporter predicate: one sender per FbTime organization', { skip }, async () => {
  const earlier = await FbTimeConnection.create({
    organizationId: ctx.org2._id, status: 'connected', keyCiphertext: sealSecret('fbt_test_otherorg001'),
    keyPrefix: 'fbt_test_oth', fbtimeOrgId: FB_ORG, keyScopes: DOOR_SCOPES, fbtimeFeatures: ['doors:reported-wins'],
    doors: { enabled: true, enabledAt: new Date(Date.now() - 3_600_000) },
  });
  const mine = await connect();
  await link(ctx.u1._id, P1);
  fake();
  assert.deepStrictEqual(await run(mine._id), { skipped: 'conflict' });
  assert.strictEqual((await conn()).doors.failCode, 'DOORS_REPORTER_TAKEN');
  assert.strictEqual(puts().length, 0);

  await FbTimeConnection.updateOne({ _id: earlier._id }, { $set: { 'doors.enabled': false } });
  await run(mine._id);
  assert.strictEqual(puts().length, 1, 'the other one turned off: this one sends');
  assert.strictEqual((await conn()).doors.failCode, undefined, 'and the conflict cleared');
  assert.strictEqual((await events('doors-recovered')).length, 1);
  await FbTimeConnection.deleteOne({ _id: earlier._id });
});

test('answers: a 400 is definitive (recorded once) and the next request still goes', { skip }, async () => {
  const c = await connect();
  // 42 linked people at 120 days → two requests (41 + 1).
  const ids = Array.from({ length: 42 }, (_, i) => `dddddddddddddddddddddd${String(i).padStart(2, '0')}`);
  for (const p of ids) await link(new mongoose.Types.ObjectId(), p);
  fake({
    doorsBefore: ({ call }) => {
      if (call === 1) throw new FbtimeApiError('counts[3].date is outside the window', { code: 'VALIDATION', status: 400, detail: { index: 3 } });
    },
  });
  await run(c._id, { deep: true });
  assert.strictEqual(puts().length, 2, 'the refusal did not stop the next request');
  let doors = (await conn()).doors;
  assert.strictEqual(doors.failCode, 'VALIDATION');
  assert.strictEqual(doors.failPhase, 'send');
  assert.deepStrictEqual(doors.failDetail, { index: 3 });
  assert.ok(doors.lastSentAt, 'every request got a definitive answer, so the send finished');
  assert.strictEqual(doors.deepRetry, undefined, 'a definitive answer discharges the 120 days owed');
  await run(c._id, { deep: true });
  assert.strictEqual((await events('doors-failed')).length, 1);
  fake();
  await run(c._id, { deep: true });
  doors = (await conn()).doors;
  assert.strictEqual(doors.failCode, undefined, 'an all-200 evaluation clears it');
  assert.strictEqual((await events('doors-recovered')).length, 1);
});

test('answers: 401 KEY_REVOKED errors the connection once; an already-errored re-probe writes nothing more', { skip }, async () => {
  const c = await connect();
  await link(ctx.u1._id, P1);
  fake({ doorsBefore: () => { throw new FbtimeApiError('revoked', { code: 'KEY_REVOKED', status: 401 }); } });
  await run(c._id);
  assert.strictEqual((await conn()).status, 'errored');
  assert.strictEqual((await events('sync-failed')).length, 1);
  assert.deepStrictEqual(await run(c._id), { skipped: 'paused' }, 'errored: the door step waits');
  assert.strictEqual((await events('sync-failed')).length, 1, 'no second event');
});

test('answers: a revoked OLD key never errors the connection now holding a new one', { skip }, async () => {
  const c = await connect();
  await link(ctx.u1._id, P1);
  fake({
    doorsBefore: async () => {
      // Replace key lands mid-request (the documented rotation: revoke → create → paste).
      await FbTimeConnection.updateOne({ _id: c._id }, { $set: { keyCiphertext: sealSecret('fbt_test_newkey000001') } });
      throw new FbtimeApiError('revoked', { code: 'KEY_REVOKED', status: 401 });
    },
  });
  await run(c._id);
  assert.strictEqual((await conn()).status, 'connected');
  assert.strictEqual((await events('sync-failed')).length, 0);
});

test('answers: a 403 SCOPE_REQUIRED re-pings and records it; a 429 ends the step as transient', { skip }, async () => {
  const c = await connect();
  await link(ctx.u1._id, P1);
  fake({
    ping: { ...doorsPing(FB_ORG), key: { scopes: ['timesheets:read', 'roster:read'] } },
    doorsBefore: () => { throw new FbtimeApiError('scope', { code: 'SCOPE_REQUIRED', status: 403 }); },
  });
  await run(c._id);
  let after = await conn();
  assert.strictEqual(after.doors.failCode, 'SCOPE_REQUIRED');
  assert.deepStrictEqual(after.keyScopes, ['timesheets:read', 'roster:read'], 'the ping stored what the key may do');

  await FbTimeConnection.updateOne({ _id: c._id }, { $set: { keyScopes: DOOR_SCOPES }, $unset: { 'doors.failCode': '' } });
  fake({ doorsBefore: () => { throw new FbtimeApiError('slow down', { code: 'RATE_LIMITED', status: 429 }); } });
  await run(c._id);
  after = await conn();
  assert.strictEqual(after.doors.transientStreak, 1);
  assert.strictEqual(after.doors.failCode, undefined);
});

test('answers: 503s continue, three in a row end the phase, the owed stay owed, eight runs read STUCK', { skip }, async () => {
  const c = await connect({}, { deepDueAt: new Date() });
  const ids = Array.from({ length: 130 }, (_, i) => `eeeeeeeeeeeeeeeeeeeee${String(i).padStart(3, '0')}`);
  for (const p of ids) await link(new mongoose.Types.ObjectId(), p);
  fake({ doorsBefore: () => { throw new FbtimeApiError('FbTime HTTP 503', { status: 503 }); } });
  await run(c._id);
  assert.strictEqual(puts().length, 3, 'four requests planned; the third 503 in a row ended the phase');
  let doors = (await conn()).doors;
  assert.strictEqual(doors.deepRetry.length, 130, 'everyone it owed 120 days is still owed');
  assert.strictEqual(doors.deepDueAt, undefined, 'a full run discharges deepDueAt even when it failed');
  assert.strictEqual(doors.lastSentAt, undefined, 'never "sent"');
  for (let i = 2; i <= 8; i++) await run(c._id);
  doors = (await conn()).doors;
  assert.strictEqual(doors.transientStreak, 8);
  assert.strictEqual(doors.failCode, 'STUCK');
  assert.strictEqual((await events('doors-failed')).length, 1);
});

test('answers: the laptop guard records a skip — never transient, never an event', { skip }, async () => {
  const c = await connect();
  await link(ctx.u1._id, P1);
  fake({ doorsBefore: () => { throw new FbtimeApiError('no', { code: 'LAPTOP_GUARD' }); } });
  await run(c._id);
  const doors = (await conn()).doors;
  assert.strictEqual(doors.lastSkip, 'laptop-guard');
  assert.strictEqual(doors.transientStreak, undefined);
  assert.strictEqual((await events()).length, 0);
});

test('the per-request gate: a Turn off mid-run stops the next request', { skip }, async () => {
  const c = await connect();
  const ids = Array.from({ length: 42 }, (_, i) => `ffffffffffffffffffffff${String(i).padStart(2, '0')}`);
  for (const p of ids) await link(new mongoose.Types.ObjectId(), p);
  fake({
    doorsAfter: async ({ call }) => {
      if (call === 1) await FbTimeConnection.updateOne({ _id: c._id }, { $set: { 'doors.enabled': false } });
    },
  });
  await run(c._id, { deep: true });
  assert.strictEqual(puts().length, 1, 'the ledger write that gates every send matched nothing');
});

test('the per-request gate: an account set that changed since the count drops that person', { skip }, async () => {
  const c = await connect();
  const ids = Array.from({ length: 42 }, (_, i) => `abababababababababab${String(i).padStart(4, '0')}`);
  for (const p of ids) await link(new mongoose.Types.ObjectId(), p);
  const last = ids.sort().at(-1); // in the second request
  fake({
    doorsAfter: async ({ call }) => {
      if (call === 1) await FbTimePersonLink.deleteOne({ organizationId: ctx.org._id, fbtimePersonId: last });
    },
  });
  await run(c._id, { deep: true });
  assert.strictEqual(puts().length, 1, 'the second request had only that person, so nothing went');
  assert.ok(!(await conn()).doors.reported.includes(last), 'and the ledger never named them');
});

test('a 120-day window never carries 7-day cells, and a count failure leaves the newly linked owed', { skip }, async () => {
  const c = await connect({}, { deepRetry: [P2] });
  await link(ctx.u1._id, P1);
  await link(ctx.u2._id, P2);
  await Campaign.updateOne({ _id: ctx.hnl._id }, { $set: { timeZone: 'us/hawaii' } });
  try {
    fake();
    await run(c._id);
    assert.strictEqual(puts().length, 0, 'a zone MongoDB cannot use: nothing is sent');
    const doors = (await conn()).doors;
    assert.strictEqual(doors.failCode, 'INVALID_TIMEZONE');
    assert.strictEqual(doors.failDetail.campaignName, 'Honolulu', 'named, so an admin can fix it');
    assert.deepStrictEqual(doors.deepRetry, [P2], 'still owed');
    assert.strictEqual((await events('doors-failed'))[0].detail.campaign, 'Honolulu');
  } finally {
    await Campaign.updateOne({ _id: ctx.hnl._id }, { $set: { timeZone: 'Pacific/Honolulu' } });
  }
  fake();
  await run(c._id);
  const [deep, recent] = [puts().find((p) => p.body.userIds.includes(P2)), puts().find((p) => p.body.userIds.includes(P1))];
  assert.strictEqual(deep.body.startDate, START, 'the owed person gets 120 days');
  assert.strictEqual(recent.body.startDate, addDays(END, -6), 'everyone else gets 7');
  assert.ok(recent.body.counts.every((x) => x.date >= recent.body.startDate));
  assert.strictEqual((await conn()).doors.deepRetry, undefined);
});

test('the typed-number notice counts only typed numbers that differed, since the latest turn-on', { skip }, async () => {
  const c = await connect();
  await link(ctx.u1._id, P1);
  fake();
  fbtimeBoard().type(P1, '2026-10-19', 2); // same as Doorline's — replaced, nothing anyone would notice
  fbtimeBoard().type(P1, '2026-10-24', 5); // differs
  await run(c._id, { deep: true });
  assert.strictEqual((await conn()).doors.replacedTyped, 1);
  assert.strictEqual(fbtimeBoard().shown(P1, '2026-10-24'), 1, 'Doorline decides');
  assert.throws(() => fbtimeBoard().type(P1, '2026-10-24', 9), /DOORS_FROM_INTEGRATION/, 'locked while a door-count key is live');
});

// ── Explicit clears ─────────────────────────────────────────────────────────
test('unlink → "the link was wrong": flagged clears from the first day sent, typed numbers restored, then the confirm pass', { skip }, async () => {
  const c = await connect();
  await link(ctx.u1._id, P1);
  fake();
  fbtimeBoard().type(P1, '2026-10-24', 5);
  await run(c._id, { deep: true });
  assert.strictEqual(fbtimeBoard().shown(P1, '2026-10-24'), 1);
  fbtimeBoard().other(P1, '2026-10-10', 3); // paper doors typed on FbTime beside Doorline's 7
  assert.strictEqual(fbtimeBoard().shown(P1, '2026-10-10'), 10);

  // What DELETE /links/:userId { doors: 'clear' } records.
  await FbTimePersonLink.deleteOne({ organizationId: ctx.org._id, userId: ctx.u1._id });
  await FbTimeConnection.updateOne({ _id: c._id }, { $push: { 'doors.clearPersons': { fbtimePersonId: P1, fromUserId: ctx.u1._id } } });
  const before = puts().length;
  await run(c._id);
  // From the first day sent to tomorrow UTC is 121 days: two slices, both flagged.
  const clears = puts().slice(before);
  assert.deepStrictEqual(clears.map((x) => x.body), [
    { startDate: START, endDate: END, userIds: [P1], counts: [], restoreTyped: true },
    { startDate: '2026-11-03', endDate: '2026-11-03', userIds: [P1], counts: [], restoreTyped: true },
  ]);
  assert.strictEqual(fbtimeBoard().shown(P1, '2026-10-24'), 5, 'the typed number came back');
  assert.strictEqual(fbtimeBoard().shown(P1, '2026-10-19'), null, 'nothing typed there: blank');
  assert.strictEqual(fbtimeBoard().shown(P1, '2026-10-10'), 3, 'other doors are never cleared');
  let doors = (await conn()).doors;
  assert.ok(doors.clearPersons[0].confirmAfter, 'the confirm pass is scheduled');
  assert.ok(doors.reported.includes(P1));

  await run(c._id, { now: minutes(NOW, 5) });
  assert.strictEqual(puts().length, before + 2, 'not due yet');
  await run(c._id, { now: minutes(NOW, 16) });
  assert.strictEqual(puts().length, before + 4, 'the confirm pass');
  doors = (await conn()).doors;
  assert.deepStrictEqual(doors.clearPersons, []);
  assert.ok(!doors.reported.includes(P1));
  assert.deepStrictEqual((await events('doors-cleared')).map((e) => e.detail), [{ count: 1 }]);
});

test('clear, then the right canvasser linked: older days cleared, the last 120 refilled in the same run', { skip }, async () => {
  const c = await connect({}, { reported: [P1], earliestDate: '2026-03-01' });
  await link(ctx.u2._id, P1); // the right canvasser now
  fake();
  fbtimeBoard().put({ startDate: '2026-03-01', endDate: '2026-06-28', userIds: [P1], counts: [{ userId: P1, date: '2026-04-01', doors: 30 }] });
  fbtimeBoard().put({ startDate: START, endDate: END, userIds: [P1], counts: [{ userId: P1, date: '2026-10-19', doors: 2 }] });
  await FbTimeConnection.updateOne({ _id: c._id }, { $push: { 'doors.clearPersons': { fbtimePersonId: P1, fromUserId: ctx.u1._id } } });
  await run(c._id);
  assert.strictEqual(fbtimeBoard().shown(P1, '2026-04-01'), null, 'cleared back to the first day sent');
  assert.strictEqual(fbtimeBoard().shown(P1, '2026-10-19'), null, 'the wrong canvasser’s day is gone');
  assert.strictEqual(fbtimeBoard().shown(P1, '2026-10-30'), 1, 'the right canvasser’s 120 days refilled');
  const refill = puts().find((p) => !p.body.restoreTyped);
  assert.strictEqual(refill.body.startDate, START);
});

test('the confirm pass catches a stalled write that landed after the first pass', { skip }, async () => {
  const c = await connect({}, { reported: [P1], earliestDate: START });
  fake();
  await FbTimeConnection.updateOne({ _id: c._id }, { $push: { 'doors.clearPersons': { fbtimePersonId: P1, fromUserId: ctx.u1._id } } });
  await run(c._id);
  // A send Doorline gave up on lands now — under "Doorline decides" it would stay locked.
  fbtimeBoard().put({ startDate: START, endDate: END, userIds: [P1], counts: [{ userId: P1, date: '2026-10-19', doors: 2 }] });
  assert.strictEqual(fbtimeBoard().shown(P1, '2026-10-19'), 2);
  await run(c._id, { now: minutes(NOW, 16) });
  assert.strictEqual(fbtimeBoard().shown(P1, '2026-10-19'), null);
});

test('a clear-all keeps group progress across runs and finishes after its confirm pass', { skip }, async () => {
  const reported = Array.from({ length: 100 }, (_, i) => `a1a1a1a1a1a1a1a1a1a1a${String(i).padStart(3, '0')}`);
  // From Aug 1: one slice per group, so a request is a group.
  const c = await connect({}, { enabled: false, reported, earliestDate: '2026-08-01', clearAll: true });
  const failing = [...reported].sort()[45]; // in the second group of 41
  let fail = true;
  fake({
    doorsBefore: ({ body }) => {
      if (fail && body.userIds.includes(failing)) throw new FbtimeApiError('FbTime HTTP 503', { status: 503 });
    },
  });
  await run(c._id);
  let doors = (await conn()).doors;
  assert.strictEqual(doors.clearAllDone.length, 59, 'groups 1 and 3 are done and saved');
  assert.ok(puts().every((p) => p.body.restoreTyped === true && p.body.counts.length === 0));

  fail = false;
  const before = puts().length;
  await run(c._id);
  assert.strictEqual(puts().length - before, 1, 'only the failed group is retried');
  doors = (await conn()).doors;
  assert.ok(doors.clearAllConfirmAfter, 'every person done: the confirm pass is scheduled');
  assert.strictEqual(doors.clearAllDone, undefined);

  await run(c._id, { now: minutes(NOW, 16) });
  doors = (await conn()).doors;
  assert.strictEqual(doors.clearAll, undefined);
  assert.strictEqual(doors.reported, undefined);
  assert.strictEqual(doors.earliestDate, undefined, 'nothing sent any more');
  assert.deepStrictEqual((await events('doors-cleared')).map((e) => e.detail), [{ count: 100 }]);
});

test('Cancel takes effect mid-run: the next clear request never goes', { skip }, async () => {
  const reported = Array.from({ length: 50 }, (_, i) => `b2b2b2b2b2b2b2b2b2b2b${String(i).padStart(3, '0')}`);
  const c = await connect({}, { enabled: false, reported, earliestDate: '2026-08-01', clearAll: true });
  fake({
    doorsAfter: async ({ call }) => {
      if (call === 1) {
        await FbTimeConnection.updateOne({ _id: c._id }, { $unset: { 'doors.clearAll': '', 'doors.clearAllDone': '' } });
      }
    },
  });
  await run(c._id);
  assert.strictEqual(puts().length, 1);
});

test('clears never touch kept accounts; a clear for a person never sent is done without a request', { skip }, async () => {
  const kept = [{ fbtimePersonId: P1, userId: ctx.u4._id, until: new Date('2026-09-01T00:00:00Z') }];
  const c = await connect({ keptAccounts: kept }, { enabled: false, clearPersons: [{ fbtimePersonId: P9, fromUserId: null }] });
  fake();
  await run(c._id);
  assert.strictEqual(puts().length, 0, 'earliestDate unset: nothing was ever sent, nothing to clear');
  const after = await conn();
  assert.deepStrictEqual(after.doors.clearPersons, []);
  assert.strictEqual(after.keptAccounts.length, 1);
});

// ── Kept accounts ───────────────────────────────────────────────────────────
test('a kept earlier account counts for its FbTime person before `until`, added to the new account', { skip }, async () => {
  // Pat's (u4) old account is kept for P1 until Oct 20; Omar (u3) is the new account.
  const until = new Date('2026-10-20T12:00:00Z');
  const c = await connect({ keptAccounts: [{ fbtimePersonId: P1, userId: ctx.u4._id, until }] });
  await link(ctx.u3._id, P1);
  const rows = await Promise.all([
    knock({ campaign: ctx.chi, user: ctx.u4._id, at: '2026-10-21T15:00:00Z' }), // after until: not counted
    knock({ campaign: ctx.chi, user: ctx.u3._id, at: '2026-10-19T16:00:00Z' }),
  ]);
  try {
    fake();
    await run(c._id, { deep: true });
    // Pat's Oct 19 knock (fixture) + Omar's Oct 19 knock, one FbTime person.
    assert.strictEqual(fbtimeBoard().shown(P1, '2026-10-19'), 2);
    assert.strictEqual(fbtimeBoard().shown(P1, '2026-10-21'), null);
  } finally {
    await CanvassActivity.deleteMany({ _id: { $in: rows.map((r) => r._id) } });
  }
});

test('the save race: the hours sync’s save never writes door state over a turn-on', { skip }, async () => {
  const c = await FbTimeConnection.create({
    organizationId: ctx.org._id, status: 'connected', keyCiphertext: sealSecret('fbt_test_racekey0001'),
    keyPrefix: 'fbt_test_rac', fbtimeOrgId: FB_ORG,
  });
  const loaded = await FbTimeConnection.findById(c._id); // loaded before the turn-on
  await FbTimeConnection.updateOne({ _id: c._id }, { $set: { 'doors.enabled': true, 'doors.enabledAt': new Date() } });
  loaded.lastSyncAt = new Date();
  await loaded.save();
  assert.strictEqual((await conn()).doors.enabled, true);
});
