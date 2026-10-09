import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Door counts to FbTime — the admin routes over the REAL app (routes/admin/integrations.js):
// the switch (every turn-on check in order), the explicit clears and Cancel, connect and
// Disconnect semantics (same org vs an organization change, a waiting clear), the link
// routes (no silent re-point, deleted accounts, "Was the link right?", Undo, Stop counting,
// the kept-account cut) and the roster / history fields the screens read.
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/doorroutes node --test test/fbtimeDoorRoutes.int.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-fbtime-door-routes';
process.env.CREDENTIAL_SEAL_KEY = process.env.CREDENTIAL_SEAL_KEY || Buffer.alloc(32, 3).toString('base64');
process.env.FBTIME_DOOR_COUNTS = 'on';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { FbTimeConnection } = await import('../src/models/FbTimeConnection.js');
const { FbTimePersonLink } = await import('../src/models/FbTimePersonLink.js');
const { FbTimeShift } = await import('../src/models/FbTimeShift.js');
const { IntegrationEvent } = await import('../src/models/IntegrationEvent.js');
const { SupportAccessGrant } = await import('../src/models/SupportAccessGrant.js');
const { createGrant } = await import('../src/services/access/supportAccess.js');
const { sealSecret } = await import('../src/utils/sealedSecret.js');
const { zonedDayRange } = await import('../src/utils/timezone.js');
const { closeQueues } = await import('../src/queues/index.js');
const { installFbtimeFake, uninstallFbtimeFake, doorsPing } = await import('./support/fbtimeFake.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const FB_ORG = 'f0000000000000000000000e';
const FB_OTHER = 'f0000000000000000000000f';
const P1 = 'dddddddddddddddddddddd01';
const P2 = 'dddddddddddddddddddddd02';
const P3 = 'dddddddddddddddddddddd03';
const P9 = 'dddddddddddddddddddddd09';
const DOOR_SCOPES = ['timesheets:read', 'roster:read', 'doors:write'];
const DAY = 86_400_000;

const ctx = {};
let server;
let base;

const call = async (method, path, { as = ctx.admin, body } = {}) => {
  const res = await fetch(`${base}/api/admin/integrations${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${as.token}`,
      'X-Org-Id': String(ctx.org._id),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};

const seed = (doors = undefined, overrides = {}) =>
  FbTimeConnection.create({
    organizationId: ctx.org._id,
    status: 'connected',
    keyCiphertext: sealSecret('fbt_test_routekey0001'),
    keyPrefix: 'fbt_test_rou',
    fbtimeOrgId: FB_ORG,
    fbtimeOrgName: 'Fake FbTime Org',
    keyScopes: DOOR_SCOPES,
    fbtimeFeatures: ['doors:reported-wins'],
    ...(doors ? { doors } : {}),
    ...overrides,
  });
const conn = () => FbTimeConnection.findOne({ organizationId: ctx.org._id }).lean();
const events = (type) => IntegrationEvent.find({ organizationId: ctx.org._id, ...(type ? { type } : {}) }).sort({ createdAt: 1 }).lean();
const link = (user, fbtimePersonId) =>
  FbTimePersonLink.create({ organizationId: ctx.org._id, userId: user._id, fbtimePersonId, source: 'manual' });
const shift = (shiftId, fbtimePersonId, clockIn, userId = null) =>
  FbTimeShift.create({
    organizationId: ctx.org._id, shiftId, fbtimePersonId, userId, clockIn,
    grossHours: 4, adjustedHours: 4, workedHours: 4,
  });
const ownerOfShift = async (shiftId) => {
  const s = await FbTimeShift.findOne({ organizationId: ctx.org._id, shiftId }).lean();
  return s.userId ? String(s.userId) : null;
};
const roster = () => [
  { id: P1, firstName: 'Maria', lastName: 'M', email: 'maria@routes.co', isActive: true },
  { id: P2, firstName: 'Nia', lastName: 'N', email: 'nia@routes.co', isActive: true },
];

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CanvassActivity, FbTimeConnection, FbTimePersonLink,
    FbTimeShift, IntegrationEvent, SupportAccessGrant]) {
    await M.deleteMany({});
  }
  const org = await Organization.create({ name: 'Routes Org', slug: 'routes-org', isActive: true });
  const org2 = await Organization.create({ name: 'Other Doorline Org', slug: 'routes-other', isActive: true });
  const mk = (first, extra = {}) =>
    User.create({ firstName: first, lastName: first[0], email: `${first.toLowerCase()}@routes.co`, passwordHash: 'x', isActive: true, ...extra });
  const admin = await mk('Ada');
  const lead = await mk('Lee');
  const staff = await mk('Sam', { isSuperAdmin: true, platformRole: 'support' });
  const maria = await mk('Maria');
  const nia = await mk('Nia');
  const omar = await mk('Omar');
  const pat = await mk('Pat');
  const gone = await User.create({
    firstName: 'Deleted', lastName: 'user', email: 'deleted-x@tombstone.invalid', passwordHash: 'x',
    isActive: false, deletedAt: new Date(Date.now() - 30 * DAY),
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  for (const u of [maria, nia, omar, pat]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: gone._id, organizationId: org._id, role: 'canvasser', isActive: false });
  await createGrant({ actorUserId: staff._id, organizationId: org._id, reason: 'door-count support test' });
  const campaign = await Campaign.create({ organizationId: org._id, name: 'Cut Camp', type: 'survey', state: 'FL', timeZone: 'America/New_York' });

  Object.assign(ctx, {
    org, org2, maria, nia, omar, pat, gone, campaign,
    admin: { token: signUserToken(admin), user: admin },
    lead: { token: signUserToken(lead) },
    staff: { token: signUserToken(staff) },
  });
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  uninstallFbtimeFake();
  delete process.env.FBTIME_DOOR_COUNTS;
  if (server) await new Promise((r) => server.close(r));
  await Promise.race([closeQueues(), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
  if (URI) await mongoose.disconnect();
});

beforeEach(async () => {
  if (!URI) return;
  process.env.FBTIME_DOOR_COUNTS = 'on';
  installFbtimeFake({ ping: doorsPing(FB_ORG), people: roster() });
  for (const M of [FbTimeConnection, FbTimePersonLink, FbTimeShift, IntegrationEvent, CanvassActivity]) await M.deleteMany({});
});

test('a lead is refused on every new route', { skip }, async () => {
  await seed();
  assert.strictEqual((await call('PATCH', '/fbtime/doors', { as: ctx.lead, body: { enabled: true } })).status, 403);
  assert.strictEqual((await call('DELETE', `/fbtime/kept/${P1}/${ctx.maria._id}`, { as: ctx.lead })).status, 403);
});

test('GET /fbtime carries what the key may do and the doors block; not connected says doorsAvailable', { skip }, async () => {
  const none = await call('GET', '/fbtime');
  assert.deepStrictEqual([none.json.connected, none.json.doorsAvailable], [false, true]);
  await seed();
  const res = await call('GET', '/fbtime');
  assert.deepStrictEqual(res.json.keyScopes, DOOR_SCOPES);
  assert.deepStrictEqual(res.json.fbtimeFeatures, ['doors:reported-wins']);
  assert.strictEqual(res.json.doors.available, true);
  assert.strictEqual(res.json.doors.state, 'off');
  assert.strictEqual(res.json.doors.canWrite, true);
  assert.strictEqual(res.json.doors.everSent, false);
});

test('turn on: every check in order, and nothing written until all pass', { skip }, async () => {
  const on = (as) => call('PATCH', '/fbtime/doors', { as, body: { enabled: true } });
  assert.strictEqual((await on(ctx.staff)).json.code, 'DOORS_STAFF_FORBIDDEN', 'staff under a grant are refused first');
  delete process.env.FBTIME_DOOR_COUNTS;
  assert.strictEqual((await on()).json.code, 'DOORS_NOT_AVAILABLE');
  process.env.FBTIME_DOOR_COUNTS = 'on';
  assert.strictEqual((await on()).json.code, 'DOORS_NOT_CONNECTED');

  const c = await seed(undefined, { status: 'errored' });
  assert.match((await on()).json.error, /needs attention/);
  await FbTimeConnection.updateOne({ _id: c._id }, { $set: { status: 'connected' } });

  installFbtimeFake({ error: { code: 'KEY_REVOKED', status: 401 } });
  const revoked = await on();
  assert.deepStrictEqual([revoked.status, revoked.json.code], [401, 'KEY_REVOKED'], 'a failed ping goes through the provider error');

  installFbtimeFake({ ping: doorsPing(FB_OTHER) });
  assert.strictEqual((await on()).json.code, 'DOORS_ORG_UNKNOWN');

  const theirs = await FbTimeConnection.create({
    organizationId: ctx.org2._id, status: 'connected', keyCiphertext: sealSecret('fbt_test_theirs00001'),
    fbtimeOrgId: FB_ORG, doors: { enabled: true, enabledAt: new Date() },
  });
  installFbtimeFake({ ping: doorsPing(FB_ORG) });
  const taken = await on();
  assert.strictEqual(taken.json.code, 'DOORS_REPORTER_TAKEN');
  assert.match(taken.json.error, /another Doorline organization/);
  assert.ok(!taken.json.error.includes('Other Doorline Org'), 'never names the other customer');
  await FbTimeConnection.deleteOne({ _id: theirs._id });

  installFbtimeFake({ ping: { ...doorsPing(FB_ORG), key: { scopes: ['timesheets:read', 'roster:read'] } } });
  assert.strictEqual((await on()).json.code, 'DOORS_SCOPE_MISSING');
  assert.deepStrictEqual((await conn()).keyScopes, ['timesheets:read', 'roster:read'], 'the card learns the key reads hours only');

  installFbtimeFake({ ping: { ...doorsPing(FB_ORG), features: ['doors:keep-typed'] } });
  assert.strictEqual((await on()).json.code, 'DOORS_FBTIME_OUTDATED');
  assert.strictEqual((await conn()).doors, undefined, 'nothing about door counts was written');
  assert.strictEqual((await events()).length, 0);

  installFbtimeFake({ ping: doorsPing(FB_ORG) });
  const ok = await on();
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.doors.state, 'starting');
  assert.deepStrictEqual(ok.json.doors.enabledBy, { name: 'Ada A' });
  const doors = (await conn()).doors;
  assert.strictEqual(doors.enabled, true);
  assert.strictEqual(String(doors.enabledByUserId), String(ctx.admin.user._id));
  assert.ok(doors.enabledAt && doors.deepDueAt);
  assert.deepStrictEqual((await events('doors-enabled')).map((e) => e.detail), [null]);

  const again = await on();
  assert.strictEqual(again.status, 200);
  assert.strictEqual((await events('doors-enabled')).length, 1, 'already on: nothing written');
});

test('turn on cancels a waiting clear-all and says so; per-person clears stay', { skip }, async () => {
  await seed({
    enabled: false, reported: [P1, P9], earliestDate: '2026-08-01', clearAll: true,
    clearPersons: [{ fbtimePersonId: P9, fromUserId: null }],
  });
  const res = await call('PATCH', '/fbtime/doors', { body: { enabled: true } });
  assert.strictEqual(res.status, 200);
  const doors = (await conn()).doors;
  assert.strictEqual(doors.clearAll, undefined);
  assert.strictEqual(doors.clearPersons.length, 1);
  assert.deepStrictEqual((await events('doors-enabled'))[0].detail, { clearCancelled: true });
});

test('turn on racing a Disconnect answers CONNECTION_CHANGED and turns nothing on', { skip }, async () => {
  const c = await seed();
  installFbtimeFake({
    ping: async () => {
      await FbTimeConnection.updateOne({ _id: c._id }, { $set: { status: 'disconnected', keyCiphertext: null } });
      return doorsPing(FB_ORG);
    },
  });
  const res = await call('PATCH', '/fbtime/doors', { body: { enabled: true } });
  assert.strictEqual(res.json.code, 'CONNECTION_CHANGED');
  assert.notStrictEqual((await conn()).doors?.enabled, true);
});

test('turn off — with and without clearing; clear while off; never while on; staff may turn off', { skip }, async () => {
  await seed({ enabled: true, enabledAt: new Date(), reported: [P1], earliestDate: '2026-08-01', failCode: 'VALIDATION', failPhase: 'send' });
  assert.strictEqual((await call('PATCH', '/fbtime/doors', { body: { clear: true } })).json.code, 'DOORS_ENABLED');

  const off = await call('PATCH', '/fbtime/doors', { as: ctx.staff, body: { enabled: false } });
  assert.strictEqual(off.status, 200);
  let doors = (await conn()).doors;
  assert.strictEqual(doors.enabled, false);
  assert.strictEqual(doors.failCode, undefined, 'turn off starts the card over');
  assert.deepStrictEqual((await events('doors-disabled'))[0].detail, { reason: 'admin', clear: false });

  delete process.env.FBTIME_DOOR_COUNTS;
  assert.strictEqual((await call('PATCH', '/fbtime/doors', { body: { clear: true } })).json.code, 'DOORS_NOT_AVAILABLE');
  process.env.FBTIME_DOOR_COUNTS = 'on';
  await FbTimeConnection.updateOne({ organizationId: ctx.org._id }, { $set: { keyScopes: ['timesheets:read'] } });
  assert.strictEqual((await call('PATCH', '/fbtime/doors', { body: { clear: true } })).json.code, 'DOORS_SCOPE_MISSING');
  await FbTimeConnection.updateOne({ organizationId: ctx.org._id }, { $set: { keyScopes: DOOR_SCOPES } });

  const clear = await call('PATCH', '/fbtime/doors', { body: { clear: true } });
  assert.strictEqual(clear.status, 200);
  assert.strictEqual(clear.json.doors.state, 'clearing');
  doors = (await conn()).doors;
  assert.strictEqual(doors.clearAll, true);
  assert.deepStrictEqual((await events('doors-clear-requested'))[0].detail, { all: true });

  await FbTimeConnection.updateOne({ organizationId: ctx.org._id }, { $set: { 'doors.enabled': true }, $unset: { 'doors.clearAll': '' } });
  await call('PATCH', '/fbtime/doors', { body: { enabled: false, clear: true } });
  assert.strictEqual((await conn()).doors.clearAll, true);
  assert.deepStrictEqual((await events('doors-disabled')).at(-1).detail, { reason: 'admin', clear: true });
});

test('clear one unlinked person, then Cancel every waiting clear; bad bodies are refused', { skip }, async () => {
  await seed({ enabled: false, reported: [P1, P2], earliestDate: '2026-08-01' });
  await link(ctx.nia, P2);
  const clearPerson = (p) => call('PATCH', '/fbtime/doors', { body: { clearPerson: p } });
  assert.strictEqual((await clearPerson(P3)).json.code, 'DOORS_NOT_SENT');
  assert.strictEqual((await clearPerson(P2)).json.code, 'DOORS_PERSON_LINKED');
  const ok = await clearPerson(P1.toUpperCase());
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await clearPerson(P1)).status, 200, 'asking twice is fine');
  let doors = (await conn()).doors;
  assert.deepStrictEqual(doors.clearPersons.map((c) => [c.fbtimePersonId, c.fromUserId ?? null]), [[P1, null]]);
  assert.deepStrictEqual((await events('doors-clear-requested')).map((e) => e.detail), [{ fbtimePersonId: P1 }]);

  const cancel = await call('PATCH', '/fbtime/doors', { body: { cancelClears: true } });
  assert.strictEqual(cancel.status, 200);
  doors = (await conn()).doors;
  assert.strictEqual(doors.clearPersons, undefined);
  assert.deepStrictEqual((await events('doors-clears-abandoned'))[0].detail, { count: 1, all: false });

  for (const body of [{}, { enabled: true, clear: true }, { clearPerson: 'nope' }, { enabled: false, cancelClears: true }]) {
    assert.strictEqual((await call('PATCH', '/fbtime/doors', { body })).status, 400, JSON.stringify(body));
  }
});

test('Replace key in the same FbTime org keeps door counts and a waiting clear, asks for a full run, and never auto-matches', { skip }, async () => {
  await seed({
    enabled: true, enabledAt: new Date(), reported: [P9], earliestDate: '2026-08-01',
    clearPersons: [{ fbtimePersonId: P9, fromUserId: null }],
  });
  const res = await call('POST', '/fbtime/connect', { body: { apiKey: 'fbt_test_replacement01' } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.autoMatched, 0);
  assert.strictEqual(res.json.orgChanged, false);
  const after = await conn();
  assert.strictEqual(after.doors.enabled, true);
  assert.strictEqual(after.doors.clearPersons.length, 1, 'the clear runs with the new key');
  assert.ok(after.doors.deepDueAt);
  assert.strictEqual(await FbTimePersonLink.countDocuments({ organizationId: ctx.org._id }), 0, 'no auto-match on a Replace key');
});

test('an organization change: confirm, then a waiting clear refuses, then leaveDoorCounts starts over', { skip }, async () => {
  await seed(
    { enabled: true, enabledAt: new Date(), reported: [P9], earliestDate: '2026-08-01', clearPersons: [{ fbtimePersonId: P9, fromUserId: null }] },
    { keptAccounts: [{ fbtimePersonId: P1, userId: ctx.pat._id, until: new Date() }] }
  );
  installFbtimeFake({ ping: doorsPing(FB_OTHER, 'Somebody Else'), people: roster() });
  const body = { apiKey: 'fbt_test_otherorgkey1' };
  assert.strictEqual((await call('POST', '/fbtime/connect', { body })).json.code, 'ORG_CHANGE_CONFIRM');
  const pending = await call('POST', '/fbtime/connect', { body: { ...body, confirmOrgChange: true } });
  assert.strictEqual(pending.json.code, 'DOORS_CLEAR_PENDING');
  assert.deepStrictEqual(pending.json.persons.map((p) => p.fbtimePersonId), [P9]);
  assert.strictEqual(pending.json.all, false);

  const ok = await call('POST', '/fbtime/connect', { body: { ...body, confirmOrgChange: true, leaveDoorCounts: true } });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.orgChanged, true);
  assert.strictEqual(ok.json.autoMatched, 2, 'a new roster: auto-match runs');
  const after = await conn();
  assert.strictEqual(after.doors, undefined, 'door counts start over for the new FbTime org');
  assert.strictEqual(after.keptAccounts.length, 1, 'kept accounts are never touched by an org change');
  assert.strictEqual(after.fbtimeOrgId, FB_OTHER);
  assert.deepStrictEqual((await events('doors-disabled'))[0].detail, { reason: 'org-changed' });
  assert.deepStrictEqual((await events('doors-clears-abandoned'))[0].detail, { count: 1, all: false });
});

test('Disconnect refuses while a first pass waits, unless leaveDoorCounts; a confirm pass alone is dropped', { skip }, async () => {
  await seed({ enabled: true, enabledAt: new Date(), reported: [P9], earliestDate: '2026-08-01', clearPersons: [{ fbtimePersonId: P9, fromUserId: null }] });
  const refused = await call('DELETE', '/fbtime');
  assert.strictEqual(refused.json.code, 'DOORS_CLEAR_PENDING');
  assert.strictEqual((await conn()).status, 'connected');
  const ok = await call('DELETE', '/fbtime', { body: { leaveDoorCounts: true } });
  assert.strictEqual(ok.status, 200);
  const after = await conn();
  assert.strictEqual(after.status, 'disconnected');
  assert.strictEqual(after.doors.enabled, false);
  assert.strictEqual(after.doors.clearPersons, undefined);
  assert.deepStrictEqual(after.doors.reported, [P9], 'the ledger stays for a same-org reconnect');
  assert.deepStrictEqual((await events('doors-disabled'))[0].detail, { reason: 'disconnected' });
  assert.strictEqual((await events('doors-clears-abandoned')).length, 1);

  await FbTimeConnection.deleteMany({});
  await seed({ enabled: false, reported: [P9], earliestDate: '2026-08-01', clearPersons: [{ fbtimePersonId: P9, fromUserId: null, confirmAfter: new Date(Date.now() + 600_000) }] });
  assert.strictEqual((await call('DELETE', '/fbtime')).status, 200, 'a pending confirm pass alone never blocks');
});

test('a reconnect starts off and keeps the ledger; a reconnect to another FbTime org starts over and auto-matches', { skip }, async () => {
  await seed({ enabled: false, reported: [P1], earliestDate: '2026-08-01', rejected: [{ fbtimePersonId: P2, userId: ctx.nia._id }] },
    { status: 'disconnected', keyCiphertext: null });
  const same = await call('POST', '/fbtime/connect', { body: { apiKey: 'fbt_test_reconnect001' } });
  assert.strictEqual(same.status, 201);
  assert.strictEqual(same.json.autoMatched, 0, 'same org: links were kept, nothing to match');
  let after = await conn();
  assert.strictEqual(after.doors.enabled, false);
  assert.deepStrictEqual(after.doors.reported, [P1]);

  await FbTimeConnection.updateOne({ organizationId: ctx.org._id }, { $set: { status: 'disconnected', keyCiphertext: null } });
  installFbtimeFake({ ping: doorsPing(FB_OTHER), people: roster() });
  const other = await call('POST', '/fbtime/connect', { body: { apiKey: 'fbt_test_reconnect002' } });
  assert.strictEqual(other.status, 201);
  assert.strictEqual(other.json.orgChanged, true);
  assert.strictEqual(other.json.autoMatched, 2, 'the rejected pair went with the old org’s door state');
  after = await conn();
  assert.strictEqual(after.doors, undefined);
});

test('two first connects at once: one connects, the other answers CONNECTION_CHANGED', { skip }, async () => {
  // Both pings are held and released together, so both requests read "no connection"
  // before either writes — the duplicate key on organizationId must become a 409.
  let release;
  const gate = new Promise((r) => (release = r));
  let waiting = 0;
  installFbtimeFake({
    ping: async () => {
      waiting += 1;
      if (waiting === 2) release();
      await gate;
      return doorsPing(FB_ORG);
    },
    people: [],
  });
  const [a, b] = await Promise.all([
    call('POST', '/fbtime/connect', { body: { apiKey: 'fbt_test_racingfirst1' } }),
    call('POST', '/fbtime/connect', { body: { apiKey: 'fbt_test_racingfirst2' } }),
  ]);
  assert.deepStrictEqual([a.status, b.status].sort(), [201, 409]);
  assert.strictEqual([a, b].find((r) => r.status === 409).json.code, 'CONNECTION_CHANGED');
  assert.strictEqual(await FbTimeConnection.countDocuments({ organizationId: ctx.org._id }), 1);
});

test('POST /test also returns FbTime’s features', { skip }, async () => {
  const res = await call('POST', '/fbtime/test', { body: { apiKey: 'fbt_test_trialkey9999' } });
  assert.deepStrictEqual(res.json.features, ['doors:reported-wins']);
  assert.deepStrictEqual(res.json.key.scopes, DOOR_SCOPES);
});

test('links: lower-cased, never a silent re-point, never a deleted account, no email in history', { skip }, async () => {
  await seed();
  const linkIt = (user, p) => call('POST', '/fbtime/links', { body: { userId: String(user._id), fbtimePersonId: p } });
  assert.strictEqual((await linkIt(ctx.maria, P1.toUpperCase())).status, 201);
  assert.strictEqual((await FbTimePersonLink.findOne({ userId: ctx.maria._id }).lean()).fbtimePersonId, P1);
  assert.strictEqual((await linkIt(ctx.maria, P1)).status, 201, 'the same pair again is fine');
  assert.strictEqual((await linkIt(ctx.maria, P2)).json.code, 'LINK_CHANGE');
  assert.strictEqual((await linkIt(ctx.nia, P1.toUpperCase())).json.code, 'LINK_TAKEN');
  assert.strictEqual((await linkIt(ctx.gone, P3)).json.code, 'ACCOUNT_DELETED');
  for (const e of await events('link-created')) assert.ok(!('userEmail' in (e.detail || {})), 'link-created stores no email');
});

test('unlink → keep, then the new account: earlier shifts stay the old account’s; Stop counting returns them', { skip }, async () => {
  await seed();
  await link(ctx.maria, P1);
  await shift('old1', P1, new Date(Date.now() - 10 * DAY), ctx.maria._id);
  const res = await call('DELETE', `/fbtime/links/${ctx.maria._id}`, { body: { doors: 'keep' } });
  assert.deepStrictEqual(res.json, { removed: true, kept: true, clear: false });
  const kept = (await conn()).keptAccounts;
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(String(kept[0].userId), String(ctx.maria._id));
  assert.strictEqual(await ownerOfShift('old1'), String(ctx.maria._id), 'kept: the hours stay measured');
  assert.deepStrictEqual((await events('account-kept')).map((e) => e.detail), [{ userId: String(ctx.maria._id), fbtimePersonId: P1 }]);

  await shift('new1', P1, new Date(Date.now() + 60_000));
  await call('POST', '/fbtime/links', { body: { userId: String(ctx.omar._id), fbtimePersonId: P1 } });
  assert.strictEqual(await ownerOfShift('old1'), String(ctx.maria._id));
  assert.strictEqual(await ownerOfShift('new1'), String(ctx.omar._id));

  const people = await call('GET', '/fbtime/people');
  const row = people.json.people.find((p) => p.fbtimePersonId === P1);
  assert.deepStrictEqual(row.alsoCounts.map((a) => a.name), ['Maria M']);

  const stop = await call('DELETE', `/fbtime/kept/${P1}/${ctx.maria._id}`);
  assert.strictEqual(stop.status, 200);
  assert.strictEqual(await ownerOfShift('old1'), String(ctx.omar._id), 'every shift of the person re-resolves');
  assert.strictEqual((await conn()).keptAccounts.length, 0);
  assert.strictEqual((await events('account-kept-removed')).length, 1);
  assert.strictEqual((await call('DELETE', `/fbtime/kept/${P1}/${ctx.maria._id}`)).status, 404);
});

test('unlink → clear only when Doorline sent; the pair is never suggested again; Undo cancels the clear', { skip }, async () => {
  await seed({ enabled: true, enabledAt: new Date(), reported: [P1], earliestDate: '2026-08-01' });
  await link(ctx.maria, P1);
  await link(ctx.nia, P2);
  const res = await call('DELETE', `/fbtime/links/${ctx.maria._id}`, { body: { doors: 'clear' } });
  assert.deepStrictEqual(res.json, { removed: true, kept: false, clear: true });
  let doors = (await conn()).doors;
  assert.deepStrictEqual(doors.clearPersons.map((c) => [c.fbtimePersonId, String(c.fromUserId)]), [[P1, String(ctx.maria._id)]]);
  assert.deepStrictEqual(doors.rejected.map((r) => [r.fbtimePersonId, String(r.userId)]), [[P1, String(ctx.maria._id)]]);
  assert.deepStrictEqual((await events('link-removed'))[0].detail, { userId: String(ctx.maria._id), fbtimePersonId: P1, doors: 'clear', clear: true });

  const people = await call('GET', '/fbtime/people');
  assert.ok(!people.json.suggestions.some((s) => s.fbtimePersonId === P1), 'a wrong link is never suggested again');
  const p1 = people.json.people.find((p) => p.fbtimePersonId === P1);
  assert.deepStrictEqual([p1.doorsSent, p1.clearWaiting, p1.canClearSent], [true, true, false]);

  const plain = await call('DELETE', `/fbtime/links/${ctx.nia._id}`, { body: { doors: 'clear' } });
  assert.strictEqual(plain.json.clear, false, 'nothing was sent for that person: a plain unlink');

  const undo = await call('POST', '/fbtime/links', { body: { userId: String(ctx.maria._id), fbtimePersonId: P1 } });
  assert.strictEqual(undo.json.clearCancelled, true);
  doors = (await conn()).doors;
  assert.deepStrictEqual(doors.clearPersons, []);
  assert.deepStrictEqual(doors.rejected, []);
  assert.strictEqual((await events('link-created')).at(-1).detail.clearCancelled, true);

  await FbTimeConnection.updateOne({ organizationId: ctx.org._id }, { $set: { status: 'disconnected', keyCiphertext: null } });
  const refused = await call('DELETE', `/fbtime/links/${ctx.maria._id}`, { body: { doors: 'clear' } });
  assert.strictEqual(refused.json.code, 'DOORS_NOT_CONNECTED');
  assert.ok(await FbTimePersonLink.exists({ userId: ctx.maria._id }), 'refused before anything changed');
});

test('auto-match skips a pair an admin said was wrong', { skip }, async () => {
  await seed({ rejected: [{ fbtimePersonId: P1, userId: ctx.maria._id }] });
  const res = await call('POST', '/fbtime/links/auto');
  assert.strictEqual(res.json.linked, 1, 'Nia matched; Maria’s rejected pair did not');
  assert.ok(!(await FbTimePersonLink.exists({ userId: ctx.maria._id })));
});

test('a kept account linked again ends its kept entry and re-resolves the old person’s shifts', { skip }, async () => {
  const until = new Date(Date.now() - DAY);
  await seed(undefined, { keptAccounts: [{ fbtimePersonId: P1, userId: ctx.nia._id, until }] });
  await shift('k1', P1, new Date(Date.now() - 5 * DAY), ctx.nia._id);
  await call('POST', '/fbtime/links', { body: { userId: String(ctx.nia._id), fbtimePersonId: P2 } });
  assert.strictEqual((await conn()).keptAccounts.length, 0);
  assert.strictEqual(await ownerOfShift('k1'), null, 'P1 is not linked: nobody');
});

test('parallel Keep unlinks keep every entry', { skip }, async () => {
  await seed();
  await link(ctx.maria, P1);
  await link(ctx.nia, P2);
  await link(ctx.omar, P3);
  await Promise.all([ctx.maria, ctx.nia, ctx.omar].map((u) => call('DELETE', `/fbtime/links/${u._id}`, { body: { doors: 'keep' } })));
  assert.strictEqual((await conn()).keptAccounts.length, 3);
});

test('the kept-account cut keeps both accounts measured, in every ordering', { skip }, async () => {
  const k = async (user, at) =>
    CanvassActivity.create({
      organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: new mongoose.Types.ObjectId(),
      userId: user._id, actionType: 'not_home', timestamp: new Date(at), location: { lat: 28.3, lng: -81.4 },
    });
  const keptUntil = async () => new Date((await conn()).keptAccounts[0].until).toISOString();
  const deletedAt = new Date('2026-09-20T16:00:00Z');

  // (1) The new account started BEFORE the old one was deleted: the cut moves `until` back
  //     to the start of the new account's first day, so its first shifts are its own.
  await seed(undefined, { keptAccounts: [{ fbtimePersonId: P1, userId: ctx.pat._id, until: deletedAt }] });
  await k(ctx.pat, '2026-08-20T15:00:00Z');
  await k(ctx.omar, '2026-09-01T18:00:00Z');
  await shift('pat-old', P1, new Date('2026-08-20T13:00:00Z'), ctx.pat._id);
  await shift('omar-first', P1, new Date('2026-09-01T13:00:00Z'), ctx.pat._id);
  await call('POST', '/fbtime/links', { body: { userId: String(ctx.omar._id), fbtimePersonId: P1 } });
  assert.strictEqual(await keptUntil(), zonedDayRange('2026-09-01', '2026-09-01', 'America/New_York').$gte.toISOString());
  assert.strictEqual(await ownerOfShift('pat-old'), String(ctx.pat._id));
  assert.strictEqual(await ownerOfShift('omar-first'), String(ctx.omar._id));

  // (2) A true overlap — the old account knocked after the new one began: the floor keeps
  //     every one of the old account's own door results before `until`.
  await call('DELETE', `/fbtime/links/${ctx.omar._id}`);
  await FbTimeConnection.updateOne({ organizationId: ctx.org._id }, { $set: { 'keptAccounts.0.until': deletedAt } });
  await k(ctx.pat, '2026-09-05T15:00:00Z');
  await call('POST', '/fbtime/links', { body: { userId: String(ctx.omar._id), fbtimePersonId: P1 } });
  assert.strictEqual(await keptUntil(), new Date(Date.parse('2026-09-05T15:00:00Z') + 1).toISOString());

  // (3) The new account started after the deletion: nothing to move.
  await call('DELETE', `/fbtime/links/${ctx.omar._id}`);
  await CanvassActivity.deleteMany({ userId: ctx.omar._id });
  await FbTimeConnection.updateOne({ organizationId: ctx.org._id }, { $set: { 'keptAccounts.0.until': deletedAt } });
  await k(ctx.omar, '2026-10-01T15:00:00Z');
  await call('POST', '/fbtime/links', { body: { userId: String(ctx.omar._id), fbtimePersonId: P1 } });
  assert.strictEqual(await keptUntil(), deletedAt.toISOString());
});

test('the roster carries door-count fields; deleted accounts read as deleted', { skip }, async () => {
  await seed({ reported: [P1, P2], earliestDate: '2026-08-01' }, {
    keptAccounts: [{ fbtimePersonId: P1, userId: ctx.gone._id, until: ctx.gone.deletedAt }],
  });
  await link(ctx.maria, P1);
  await FbTimePersonLink.create({ organizationId: ctx.org._id, userId: ctx.gone._id, fbtimePersonId: P3, source: 'manual' });
  installFbtimeFake({ ping: doorsPing(FB_ORG), people: [...roster(), { id: P3, firstName: 'Gone', lastName: 'G', email: null, isActive: false }] });
  const res = await call('GET', '/fbtime/people');
  const by = Object.fromEntries(res.json.people.map((p) => [p.fbtimePersonId, p]));
  assert.deepStrictEqual([by[P1].doorsSent, by[P1].canClearSent, by[P1].deleted], [true, false, false]);
  assert.deepStrictEqual(by[P1].alsoCounts.map((a) => [a.name, a.deleted]), [['Deleted user', true]]);
  assert.deepStrictEqual([by[P2].doorsSent, by[P2].canClearSent], [true, true], 'sent, not linked now: offer the clear');
  assert.deepStrictEqual([by[P3].deleted, by[P3].linkedStatus], [true, 'deleted']);
});

test('history names who did it; automatic rows read null', { skip }, async () => {
  await IntegrationEvent.create({ organizationId: ctx.org._id, byUserId: ctx.admin.user._id, type: 'doors-enabled' });
  await IntegrationEvent.create({ organizationId: ctx.org._id, byUserId: null, type: 'doors-cleared', detail: { count: 3 } });
  await IntegrationEvent.create({
    organizationId: ctx.org._id, byUserId: ctx.admin.user._id, type: 'account-kept',
    detail: { userId: String(ctx.maria._id).toUpperCase(), fbtimePersonId: P1 },
  });
  const res = await call('GET', '/fbtime/events');
  const byType = Object.fromEntries(res.json.events.map((e) => [e.type, e]));
  assert.deepStrictEqual(byType['doors-enabled'].by, { name: 'Ada A', status: 'active' });
  assert.strictEqual(byType['doors-cleared'].by, null);
  assert.deepStrictEqual(byType['account-kept'].subject, { name: 'Maria M', status: 'active' });
});
