import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The /admin/integrations/fbtime routes over the REAL app: connect flow (test →
// confirm → connect), key sealing, the wrong-customer-key rotate gate, the
// figure setting, disconnect semantics, links (manual/auto/unlink + cache
// backfill), role gating, and the append-only history.
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/fbtint node --test test/fbtimeIntegration.int.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-fbtime-int';
process.env.CREDENTIAL_SEAL_KEY = process.env.CREDENTIAL_SEAL_KEY || Buffer.alloc(32, 9).toString('base64');

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { FbTimeConnection } = await import('../src/models/FbTimeConnection.js');
const { FbTimeShift } = await import('../src/models/FbTimeShift.js');
const { FbTimePersonLink } = await import('../src/models/FbTimePersonLink.js');
const { IntegrationEvent } = await import('../src/models/IntegrationEvent.js');
const { openSecret } = await import('../src/utils/sealedSecret.js');
const { closeQueues } = await import('../src/queues/index.js');
const { installFbtimeFake, uninstallFbtimeFake } = await import('./support/fbtimeFake.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const P1 = 'bbbbbbbbbbbbbbbbbbbbbbb1';
const P2 = 'bbbbbbbbbbbbbbbbbbbbbbb2';

let server;
let base;
const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, FbTimeConnection, FbTimeShift, FbTimePersonLink, IntegrationEvent]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'IntOrg', slug: 'int-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'A', email: 'ada@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'L', email: 'lee@t.co', passwordHash: 'x', isActive: true });
  const maria = await User.create({ firstName: 'Maria', lastName: 'M', email: 'maria@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: maria._id, organizationId: org._id, role: 'canvasser', isActive: true });

  Object.assign(ctx, {
    org,
    maria,
    admin: { token: signUserToken(admin), orgId: org._id },
    lead: { token: signUserToken(lead), orgId: org._id },
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  uninstallFbtimeFake();
  if (server) await new Promise((r) => server.close(r));
  // The connect route touches BullMQ (fire-and-forget); close any queue the
  // suite created so the process can exit without a lingering redis handle.
  await Promise.race([closeQueues(), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, orgId, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const fakePing = (orgId = 'f0000000000000000000000a', name = 'Fake FbTime Org') => ({
  ok: true,
  organization: { id: orgId, name },
  key: { name: 'Doorline (local dev)', prefix: 'fbt_test_ab', scopes: ['timesheets:read', 'roster:read'] },
});

test('a lead cannot even read the integration surface', { skip }, async () => {
  const res = await call('GET', '/admin/integrations/fbtime', ctx.lead);
  assert.strictEqual(res.status, 403);
});

test('GET before any connection: {connected:false}', { skip }, async () => {
  const res = await call('GET', '/admin/integrations/fbtime', ctx.admin);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.connected, false);
});

test('POST /test validates the key WITHOUT storing anything', { skip }, async () => {
  installFbtimeFake({ ping: fakePing() });
  const res = await call('POST', '/admin/integrations/fbtime/test', { ...ctx.admin, body: { apiKey: 'fbt_test_trialkey9999' } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.organization.name, 'Fake FbTime Org');
  assert.strictEqual(await FbTimeConnection.countDocuments({}), 0, 'test stores nothing');
});

test('connect seals the key, records the FbTime org, audits, and never echoes the secret', { skip }, async () => {
  installFbtimeFake({ ping: fakePing(), people: [] });
  const res = await call('POST', '/admin/integrations/fbtime/connect', { ...ctx.admin, body: { apiKey: 'fbt_test_realkey12345' } });
  assert.strictEqual(res.status, 201);
  assert.ok(!JSON.stringify(res.json).includes('realkey12345'), 'the key never rides a response');

  const connection = await FbTimeConnection.findOne({ organizationId: ctx.org._id });
  assert.strictEqual(connection.status, 'connected');
  assert.notStrictEqual(connection.keyCiphertext, 'fbt_test_realkey12345', 'sealed, not plaintext');
  assert.ok(connection.keyCiphertext.startsWith('v1:'));
  assert.strictEqual(openSecret(connection.keyCiphertext), 'fbt_test_realkey12345', 'round-trips');
  assert.strictEqual(connection.hourFigure, 'adjustedHours', 'the owner-ruled default');
  assert.strictEqual(connection.fbtimeOrgName, 'Fake FbTime Org');

  const events = await IntegrationEvent.find({ organizationId: ctx.org._id, type: 'connected' });
  assert.strictEqual(events.length, 1);
});

test('rotating to a key that reads a DIFFERENT FbTime org demands confirmation', { skip }, async () => {
  installFbtimeFake({ ping: fakePing('f0000000000000000000000b', 'Somebody Else Inc'), people: [] });
  const refused = await call('POST', '/admin/integrations/fbtime/connect', { ...ctx.admin, body: { apiKey: 'fbt_test_wrongcustomer' } });
  assert.strictEqual(refused.status, 409);
  assert.strictEqual(refused.json.code, 'ORG_CHANGE_CONFIRM');

  const confirmed = await call('POST', '/admin/integrations/fbtime/connect', {
    ...ctx.admin,
    body: { apiKey: 'fbt_test_wrongcustomer', confirmOrgChange: true },
  });
  assert.strictEqual(confirmed.status, 200, 'explicit confirmation proceeds as a rotate');
  assert.strictEqual((await IntegrationEvent.countDocuments({ organizationId: ctx.org._id, type: 'key-rotated' })), 1);

  // Rotate back for the rest of the suite.
  installFbtimeFake({ ping: fakePing(), people: [] });
  await call('POST', '/admin/integrations/fbtime/connect', {
    ...ctx.admin,
    body: { apiKey: 'fbt_test_realkey12345', confirmOrgChange: true },
  });
});

test('the figure setting accepts only the three wire names and audits changes', { skip }, async () => {
  const bad = await call('PATCH', '/admin/integrations/fbtime/settings', { ...ctx.admin, body: { hourFigure: 'paidHours' } });
  assert.strictEqual(bad.status, 400, 'the pre-rename name is not a valid figure');

  const ok = await call('PATCH', '/admin/integrations/fbtime/settings', { ...ctx.admin, body: { hourFigure: 'workedHours' } });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await FbTimeConnection.findOne({ organizationId: ctx.org._id })).hourFigure, 'workedHours');
  assert.strictEqual(await IntegrationEvent.countDocuments({ organizationId: ctx.org._id, type: 'figure-changed' }), 1);

  await call('PATCH', '/admin/integrations/fbtime/settings', { ...ctx.admin, body: { hourFigure: 'adjustedHours' } });
});

test('manual link backfills the cache immediately; unlink reverts it to unmapped', { skip }, async () => {
  await FbTimeShift.create({
    organizationId: ctx.org._id, shiftId: 'link1', fbtimePersonId: P1, userId: null,
    clockIn: new Date('2026-08-10T13:00:00Z'), grossHours: 6, adjustedHours: 5.5, workedHours: 5.25,
  });

  const bad = await call('POST', '/admin/integrations/fbtime/links', { ...ctx.admin, body: { userId: String(ctx.maria._id), fbtimePersonId: 'not-hex' } });
  assert.strictEqual(bad.status, 400, 'malformed person id refused before it can ever travel');

  const res = await call('POST', '/admin/integrations/fbtime/links', { ...ctx.admin, body: { userId: String(ctx.maria._id), fbtimePersonId: P1 } });
  assert.strictEqual(res.status, 201);
  let row = await FbTimeShift.findOne({ organizationId: ctx.org._id, fbtimePersonId: P1 });
  assert.strictEqual(String(row.userId), String(ctx.maria._id), 'cache backfilled without waiting for a poll');

  const gone = await call('DELETE', `/admin/integrations/fbtime/links/${ctx.maria._id}`, ctx.admin);
  assert.strictEqual(gone.status, 200);
  row = await FbTimeShift.findOne({ organizationId: ctx.org._id, fbtimePersonId: P1 });
  assert.strictEqual(row.userId, null, 'unlink reverts rows to unmapped, never deletes them');
});

test('auto-match links by lowercase email, skips the already-linked, and audits a count', { skip }, async () => {
  installFbtimeFake({
    people: [
      { id: P1, firstName: 'Maria', lastName: 'M', email: 'MARIA@T.CO', isActive: true },
      { id: P2, firstName: 'Nobody', lastName: 'N', email: 'nobody@elsewhere.co', isActive: true },
    ],
  });
  const res = await call('POST', '/admin/integrations/fbtime/links/auto', ctx.admin);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.linked, 1, 'case-insensitive email match');

  const link = await FbTimePersonLink.findOne({ organizationId: ctx.org._id, fbtimePersonId: P1 });
  assert.strictEqual(link.source, 'auto-email');
  assert.strictEqual(link.linkedByUserId, null, 'the auto pass, not a person');

  const again = await call('POST', '/admin/integrations/fbtime/links/auto', ctx.admin);
  assert.strictEqual(again.json.linked, 0, 'idempotent — an unlink is never silently redone');
});

test('the roster proxy marks unmatched-with-hours and offers email suggestions', { skip }, async () => {
  await FbTimeShift.create({
    organizationId: ctx.org._id, shiftId: 'unm1', fbtimePersonId: P2, userId: null,
    clockIn: new Date('2026-08-11T13:00:00Z'), grossHours: 3, adjustedHours: 3, workedHours: 3,
  });
  installFbtimeFake({
    people: [
      { id: P1, firstName: 'Maria', lastName: 'M', email: 'maria@t.co', isActive: true },
      { id: P2, firstName: 'Nobody', lastName: 'N', email: 'nobody@elsewhere.co', isActive: true },
    ],
  });
  const res = await call('GET', '/admin/integrations/fbtime/people', ctx.admin);
  assert.strictEqual(res.status, 200);
  const p2 = res.json.people.find((p) => p.fbtimePersonId === P2);
  assert.strictEqual(p2.hasUnmatchedHours, true, 'clocked hours with no linked canvasser is flagged');
  const p1 = res.json.people.find((p) => p.fbtimePersonId === P1);
  assert.strictEqual(p1.linkedUserId, String(ctx.maria._id));
});

test('disconnect clears the ciphertext, DELETES the cache, and keeps links + history', { skip }, async () => {
  assert.ok(await FbTimeShift.countDocuments({ organizationId: ctx.org._id }) > 0);
  const res = await call('DELETE', '/admin/integrations/fbtime', ctx.admin);
  assert.strictEqual(res.status, 200);

  const connection = await FbTimeConnection.findOne({ organizationId: ctx.org._id });
  assert.strictEqual(connection.status, 'disconnected');
  assert.strictEqual(connection.keyCiphertext, null, 'a disconnected row holds no working credential');
  assert.strictEqual(await FbTimeShift.countDocuments({ organizationId: ctx.org._id }), 0, 'reports revert instantly');
  assert.ok(await FbTimePersonLink.countDocuments({ organizationId: ctx.org._id }) > 0, 'the mapping labor survives');
  assert.ok(await IntegrationEvent.countDocuments({ organizationId: ctx.org._id, type: 'disconnected' }) === 1);

  const status = await call('GET', '/admin/integrations/fbtime', ctx.admin);
  assert.strictEqual(status.json.connected, false, 'indistinguishable from never-connected');
});

test('history is served newest-first and never carries a key', { skip }, async () => {
  const res = await call('GET', '/admin/integrations/fbtime/events', ctx.admin);
  assert.strictEqual(res.status, 200);
  assert.ok(res.json.events.length >= 5);
  const times = res.json.events.map((e) => new Date(e.at).getTime());
  assert.deepStrictEqual(times, [...times].sort((a, b) => b - a));
  assert.ok(!JSON.stringify(res.json).includes('realkey12345'));
});
