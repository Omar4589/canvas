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
// Never returned by the fake's /people — the "gone from the provider roster" cases.
const P_GONE = 'bbbbbbbbbbbbbbbbbbbbbbb9';
const P_GHOST = 'bbbbbbbbbbbbbbbbbbbbbbb8';

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
    leadUser: lead, // the doc, not just the auth — an orphan-link fixture needs a real userId
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

test('manual refresh enqueues once and then holds a one-minute cooldown', { skip }, async () => {
  const first = await call('POST', '/admin/integrations/fbtime/sync', ctx.admin);
  assert.strictEqual(first.status, 202);
  assert.strictEqual(first.json.queued, true);
  assert.ok(!Number.isNaN(new Date(first.json.requestedAt).getTime()), 'requestedAt is the server instant the client polls against');

  const connection = await FbTimeConnection.findOne({ organizationId: ctx.org._id });
  assert.ok(connection.manualSyncRequestedAt, 'the cooldown stamp landed');

  const second = await call('POST', '/admin/integrations/fbtime/sync', ctx.admin);
  assert.strictEqual(second.status, 429);
  assert.strictEqual(second.json.code, 'SYNC_COOLDOWN');

  // An expired cooldown admits the next request.
  await FbTimeConnection.updateOne(
    { organizationId: ctx.org._id },
    { $set: { manualSyncRequestedAt: new Date(Date.now() - 120_000) } }
  );
  const third = await call('POST', '/admin/integrations/fbtime/sync', ctx.admin);
  assert.strictEqual(third.status, 202);

  // The status wire carries the failure stamp the refresh poll reads.
  const status = await call('GET', '/admin/integrations/fbtime', ctx.admin);
  assert.ok('lastErrorAt' in status.json, 'lastErrorAt rides the status payload');
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

test('the roster proxy surfaces people it CANNOT return: orphan links and ghost hours', { skip }, async () => {
  // Two states the proxy alone cannot express, and both are invisible today:
  //  · a link whose FbTime person left the provider's roster — it still
  //    attributes cached hours, and the old page drew it as the word "Linked";
  //  · unlinked hours from a person off the roster — GET /fbtime counts them in
  //    unmatchedWithHours, so the banner counted a row the table could not show.
  await FbTimePersonLink.create({
    organizationId: ctx.org._id, userId: ctx.leadUser._id, fbtimePersonId: P_GONE,
    fbtimeName: 'Departed Dana', fbtimeEmail: 'dana@fb.co', source: 'manual',
  });
  await FbTimeShift.create({
    organizationId: ctx.org._id, shiftId: 'ghost1', fbtimePersonId: P_GHOST, userId: null,
    clockIn: new Date('2026-08-12T13:00:00Z'), grossHours: 2, adjustedHours: 2, workedHours: 2,
  });
  installFbtimeFake({
    people: [{ id: P1, firstName: 'Maria', lastName: 'M', email: 'maria@t.co', isActive: true }],
  });

  const res = await call('GET', '/admin/integrations/fbtime/people', ctx.admin);
  assert.strictEqual(res.status, 200);

  const orphan = res.json.orphanLinks.find((l) => l.fbtimePersonId === P_GONE);
  assert.ok(orphan, 'a link to somebody off the roster is reported');
  assert.strictEqual(orphan.fbtimeName, 'Departed Dana', 'the denormalized label is the only identity left');
  assert.ok(!res.json.people.some((p) => p.fbtimePersonId === P_GONE), 'and it is NOT in people[]');

  assert.ok(res.json.ghostPersonIds.includes(P_GHOST), 'unlinked hours from an off-roster person are reported');
  assert.ok(!res.json.ghostPersonIds.includes(P_GONE), 'a LINKED off-roster person is an orphan, never a ghost');

  // The banner count and the rows the table can build must describe one world.
  const status = await call('GET', '/admin/integrations/fbtime', ctx.admin);
  const showable = res.json.people.filter((p) => p.hasUnmatchedHours).length + res.json.ghostPersonIds.length;
  assert.strictEqual(status.json.unmatchedWithHours, showable, 'every counted person has a row to land in');

  await FbTimePersonLink.deleteOne({ organizationId: ctx.org._id, fbtimePersonId: P_GONE });
});

test('a MANUAL link stores the display labels the auto pass has always stored', { skip }, async () => {
  // FbTimePersonLink carries fbtimeName/fbtimeEmail so a row still means something
  // once the person leaves /people — but only autoMatchByEmail ever wrote them, so
  // every hand-made link was blank in exactly the case the fields exist for.
  await FbTimePersonLink.deleteOne({ organizationId: ctx.org._id, userId: ctx.maria._id });
  const res = await call('POST', '/admin/integrations/fbtime/links', {
    ...ctx.admin,
    body: { userId: String(ctx.maria._id), fbtimePersonId: P1, fbtimeName: 'Maria M', fbtimeEmail: 'MARIA@T.CO' },
  });
  assert.strictEqual(res.status, 201);
  const link = await FbTimePersonLink.findOne({ organizationId: ctx.org._id, userId: ctx.maria._id }).lean();
  assert.strictEqual(link.fbtimeName, 'Maria M');
  assert.strictEqual(link.fbtimeEmail, 'maria@t.co', 'lowercased on the way in, like the auto pass');

  // Re-linking WITHOUT labels must not blank the ones already stored.
  const again = await call('POST', '/admin/integrations/fbtime/links', {
    ...ctx.admin,
    body: { userId: String(ctx.maria._id), fbtimePersonId: P1 },
  });
  assert.strictEqual(again.status, 201);
  const after = await FbTimePersonLink.findOne({ organizationId: ctx.org._id, userId: ctx.maria._id }).lean();
  assert.strictEqual(after.fbtimeName, 'Maria M', 'an omitted label leaves the stored one alone');
});

test('recent projects group per person, order by recency, and cap at three', { skip }, async () => {
  const shift = (id, personId, day, project) => ({
    id, userId: personId, clockIn: `2026-08-${day}T13:00:00Z`,
    grossHours: 4, adjustedHours: 4, workedHours: 4, isOpen: false, isManualEntry: false,
    entryTimeZone: 'America/New_York', project,
  });
  installFbtimeFake({
    people: [{ id: P1, firstName: 'Maria', lastName: 'M', email: 'maria@t.co', isActive: true }],
    shifts: [
      shift('s1', P1, '10', { id: 'pr1', name: 'Ward 5 Field' }),
      shift('s2', P1, '11', { id: 'pr1', name: 'Ward 5 Field' }),
      shift('s3', P1, '20', { id: 'pr2', name: 'Warehouse' }),
      shift('s4', P1, '12', { id: 'pr3', name: 'Phone Bank' }),
      shift('s5', P1, '13', { id: 'pr4', name: 'Training' }),
      shift('s6', P2, '14', { id: 'pr1', name: 'Ward 5 Field' }),
      shift('s7', P2, '15', null), // a shift with no project must be skipped, not crash
    ],
  });

  const res = await call('GET', '/admin/integrations/fbtime/projects', ctx.admin);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.degraded, false);
  assert.strictEqual(res.json.windowDays, 30, 'the default trailing window');

  const p1 = res.json.projects.find((r) => r.fbtimePersonId === P1);
  assert.strictEqual(p1.projects.length, 3, 'capped — one label would hide a split week, four is noise');
  assert.strictEqual(p1.projects[0].name, 'Warehouse', 'most recent first');
  assert.strictEqual(p1.projects.at(-1).name, 'Phone Bank');
  assert.ok(!p1.projects.some((x) => x.name === 'Ward 5 Field'), 'the oldest of five falls off the cap');

  const p2 = res.json.projects.find((r) => r.fbtimePersonId === P2);
  assert.strictEqual(p2.projects.length, 1, 'the project-less shift is skipped, the other still counts');
  assert.strictEqual(p2.projects[0].shifts, 1);

  // THE INVARIANT: a label is displayed, never stored. FbTimeShift's whole
  // comment block says "DELIBERATELY NOT STORED", and hours are attributed by the
  // knock ledger — owner-ruled 2026-08-16, never by FbTime location.
  const stored = await FbTimeShift.find({ organizationId: ctx.org._id }).lean();
  for (const row of stored) {
    assert.ok(!('project' in row), 'no shift document may ever hold a project label');
    assert.ok(!('projectName' in row) && !('projectId' in row));
  }
});

test('a failing projects pull degrades to 200 and never takes the roster down with it', { skip }, async () => {
  // This column is decoration. The roster is the request the table cannot render
  // without, which is why the two are separate routes in the first place.
  installFbtimeFake({
    people: [{ id: P1, firstName: 'Maria', lastName: 'M', email: 'maria@t.co', isActive: true }],
    error: { code: 'RATE_LIMITED', status: 429 },
  });
  const res = await call('GET', '/admin/integrations/fbtime/projects', ctx.admin);
  assert.strictEqual(res.status, 200, 'a provider refusal must not paint an error over a working table');
  assert.strictEqual(res.json.degraded, true);
  assert.strictEqual(res.json.reason, 'RATE_LIMITED');
  assert.deepStrictEqual(res.json.projects, []);
  assert.ok(!JSON.stringify(res.json).includes('realkey12345'), 'and never carries the key');
});

test('projects is admin-only, like every other route on this router', { skip }, async () => {
  const res = await call('GET', '/admin/integrations/fbtime/projects', ctx.lead);
  assert.strictEqual(res.status, 403);
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

test('manual refresh refuses when disconnected — nothing to pull with', { skip }, async () => {
  const res = await call('POST', '/admin/integrations/fbtime/sync', ctx.admin);
  assert.strictEqual(res.status, 404);
});

test('projects refuses when disconnected — a precondition, not a provider failure', { skip }, async () => {
  const res = await call('GET', '/admin/integrations/fbtime/projects', ctx.admin);
  assert.strictEqual(res.status, 404, 'no connection is a 404, distinct from the degraded 200');
});

test('history is served newest-first and never carries a key', { skip }, async () => {
  const res = await call('GET', '/admin/integrations/fbtime/events', ctx.admin);
  assert.strictEqual(res.status, 200);
  assert.ok(res.json.events.length >= 5);
  const times = res.json.events.map((e) => new Date(e.at).getTime());
  assert.deepStrictEqual(times, [...times].sort((a, b) => b - a));
  assert.ok(!JSON.stringify(res.json).includes('realkey12345'));
});
