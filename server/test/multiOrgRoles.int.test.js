import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The multi-org, mixed-role contract, exercised over the REAL Express app + a throwaway
// mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/multiorg_test node --test test/multiOrgRoles.int.test.js
//
// Seed: ONE user who is an `admin` in Org A and a `canvasser` in Org B — the exact shape
// that dead-ended the web console (the org picker listed Org B, picking it routed to the
// admin-only /admin, and the Forbidden screen replaced the whole app with no way back).
//
// The fix is client-side (client/src/lib/roles.js filters the picker + switcher), so what
// this suite locks is the SERVER contract the client's filter depends on:
//   1. /auth/login returns BOTH memberships with their true roles — the client needs the
//      canvasser row to render the muted "No console access" section, so the server must
//      NOT filter it out.
//   2. The server never trusted the client's role logic anyway: an admin-only route with
//      X-Org-Id: B is 403, whatever the client believes.
//   3. Those 403s now carry machine-readable codes, so both clients can self-heal:
//      FORBIDDEN_ROLE = "your role is too low here"; ORG_CONTEXT = "that's not your org".
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-multi-org';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const PASSWORD = 'Sup3r-Str0ng-Pw!';

let server;
let base;
const ctx = {}; // { orgA, orgB, orgC, user, tok }

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership]) await M.deleteMany({});

  const orgA = await Organization.create({ name: 'Org A', slug: 'org-a-multi', isActive: true });
  const orgB = await Organization.create({ name: 'Org B', slug: 'org-b-multi', isActive: true });
  // A third org the user has NO membership in at all — the "removed from the org" / stale
  // activeOrgId case, which must 403 with ORG_CONTEXT (not FORBIDDEN_ROLE).
  const orgC = await Organization.create({ name: 'Org C', slug: 'org-c-multi', isActive: true });

  const user = await User.create({
    firstName: 'Mix',
    lastName: 'Roles',
    email: 'mixed@t.co',
    passwordHash: await User.hashPassword(PASSWORD),
    isActive: true,
  });
  await Membership.create({ userId: user._id, organizationId: orgA._id, role: 'admin', isActive: true });
  await Membership.create({ userId: user._id, organizationId: orgB._id, role: 'canvasser', isActive: true });

  Object.assign(ctx, { orgA, orgB, orgC, user, tok: signUserToken(user) });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, orgId, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['X-Org-Id'] = String(orgId);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

test('login returns BOTH memberships with their true roles', { skip }, async () => {
  const { orgA, orgB } = ctx;
  const { status, json } = await call('POST', '/api/auth/login', {
    body: { email: 'mixed@t.co', password: PASSWORD },
  });
  assert.strictEqual(status, 200);

  const byOrg = new Map((json.memberships || []).map((m) => [String(m.organizationId), m]));
  assert.strictEqual(byOrg.size, 2, 'both memberships must ship to the client');
  // The client filters these into selectable (admin/lead) vs muted (canvasser). If the
  // server ever dropped the canvasser row, the picker could not explain Org B's absence.
  assert.strictEqual(byOrg.get(String(orgA._id)).role, 'admin');
  assert.strictEqual(byOrg.get(String(orgB._id)).role, 'canvasser');
});

test('the admin org (A) works: an admin-only route is 200', { skip }, async () => {
  const { tok, orgA } = ctx;
  const { status } = await call('GET', '/api/admin/memberships', { token: tok, orgId: orgA._id });
  assert.strictEqual(status, 200);
});

test('the canvasser org (B) is 403 FORBIDDEN_ROLE on admin-only routes', { skip }, async () => {
  const { tok, orgB } = ctx;
  // This is the request the web console used to fire after the user picked Org B in the
  // picker. The server always rejected it — the bug was purely that the client offered the
  // choice and then had no way back from the rejection.
  for (const path of ['/api/admin/memberships', '/api/admin/campaigns', '/api/admin/voters']) {
    const { status, json } = await call('GET', path, { token: tok, orgId: orgB._id });
    assert.strictEqual(status, 403, `${path} expected 403, got ${status}`);
    assert.strictEqual(json.code, 'FORBIDDEN_ROLE', `${path} must carry a machine-readable code`);
  }
});

test('an org with no membership is 403 ORG_CONTEXT, not FORBIDDEN_ROLE', { skip }, async () => {
  const { tok, orgC } = ctx;
  // Distinct code on purpose: ORG_CONTEXT means "that's not your org" → both clients drop
  // the stale activeOrgId and route to the picker. FORBIDDEN_ROLE means "the org is fine,
  // your role isn't" → the web client must NOT eject the user over it.
  const { status, json } = await call('GET', '/api/admin/campaigns', { token: tok, orgId: orgC._id });
  assert.strictEqual(status, 403);
  assert.strictEqual(json.code, 'ORG_CONTEXT');
});

test('a bogus X-Org-Id is tagged ORG_CONTEXT so the client can self-heal', { skip }, async () => {
  const { tok } = ctx;
  const bogus = await call('GET', '/api/admin/campaigns', { token: tok, orgId: 'not-an-objectid' });
  assert.strictEqual(bogus.status, 400);
  assert.strictEqual(bogus.json.code, 'ORG_CONTEXT');

  // A well-formed id for an org that doesn't exist (e.g. a deleted org still in localStorage).
  const gone = await call('GET', '/api/admin/campaigns', {
    token: tok,
    orgId: new mongoose.Types.ObjectId(),
  });
  assert.strictEqual(gone.status, 404);
  assert.strictEqual(gone.json.code, 'ORG_CONTEXT');
});

test('X-Org-Id is NOT auto-picked for a multi-org user', { skip }, async () => {
  const { tok } = ctx;
  // orgContext only auto-picks when the user has exactly ONE active membership. With two,
  // omitting the header must leave no active org — so a client that forgets to send it can
  // never silently act against the wrong org.
  const { status } = await call('GET', '/api/admin/memberships', { token: tok });
  assert.strictEqual(status, 403);
});

test('the canvasser org still serves the routes a canvasser is entitled to', { skip }, async () => {
  const { tok, orgB } = ctx;
  // requireOrgMember (not requireOrgRole) routes: a canvasser membership is a real, working
  // membership — it just has no console. Proves the fix doesn't over-restrict Org B.
  const { status } = await call('GET', '/api/help/index', { token: tok, orgId: orgB._id });
  assert.ok(status < 400, `GET /api/help/index as a canvasser expected <400, got ${status}`);
});
