import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Concurrent lifecycle writes on ONE walk list — docs/PROPOSAL_WALK_LIST_ARCHIVE.md §C.2 (the
// lifecycle lock), §G ("Two admins act on one walk list at once") — over the REAL Express app + a
// throwaway mongod:
//   npm run test:int -- test/passLifecycleRace.int.test.js
//
// Per-pass recut locks can't serialize a bring-back of Pass 2 against an archive of North, or a
// bring-back against an activation (different passes, different locks); the walk list's lifecycle
// lock does. Each race below fires the two requests together with Promise.all, several times on fresh
// fixtures, and whatever the interleaving it must hold that:
//   • an archived walk list never has a live pass, and a walk list never has two live passes;
//   • the loser answers 409 (lifecycle-busy when they overlapped, or the rule the winner's change
//     now trips when they didn't) and changed nothing of its own;
//   • every lock is released.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-pass-lifecycle-race';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { acquireRecutLock, releaseRecutLock } = await import('../src/services/turf/recutLock.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const ROUNDS = 12;

let server;
let base;
const ctx = {};

let doorSeq = 0;
const makeHousehold = (campaign, effortId) => {
  doorSeq += 1;
  return {
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    effortId,
    addressLine1: `${doorSeq} Race Ln`,
    city: 'Austin',
    state: 'TX',
    zipCode: '78703',
    normalizedAddress: `${doorSeq} race ln austin tx 78703`,
    location: { type: 'Point', coordinates: [-97.75 + (doorSeq % 9) * 0.0002, 30.28 + Math.floor(doorSeq / 9) * 0.0002] },
    status: 'unknocked',
    isActive: true,
  };
};

const call = async (method, path, { token, orgId, body } = {}) => {
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
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
};

const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });
const asOther = () => ({ token: ctx.otherTok, orgId: ctx.org._id });
const efforts = (rest = '') => `/admin/campaigns/${ctx.campaign._id}/efforts${rest}`;
const passes = (rest = '') => `/admin/campaigns/${ctx.campaign._id}/passes${rest}`;
const show = (r) => JSON.stringify(r.json);
const fresh = (M, doc) => M.findById(doc._id).lean();
const ms = (d) => (d ? new Date(d).getTime() : null);
const sleep = (n) => new Promise((r) => setTimeout(r, n));
const outcome = (r) => (r.status === 200 ? '200' : `${r.status} ${r.json?.code}`);

const seedWalkList = async (name, passCount = 2) => {
  const c = ctx.campaign;
  const effort = await Effort.create({ organizationId: c.organizationId, campaignId: c._id, name, status: 'active' });
  const hh = await Household.insertMany(Array.from({ length: 3 }, () => makeHousehold(c, effort._id)));
  const ps = [];
  for (let i = 0; i < passCount; i += 1) {
    const pass = await Pass.create({ organizationId: c.organizationId, campaignId: c._id, effortId: effort._id, roundNumber: i + 1, name: `Pass ${i + 1}`, status: 'draft' });
    const book = await Turf.create({
      organizationId: c.organizationId, campaignId: c._id, passId: pass._id, name: `${name} P${i + 1}`, mode: 'manual',
      status: 'published', householdIds: hh.map((h) => h._id), doorCount: hh.length,
    });
    await TurfAssignment.create({ turfId: book._id, userId: ctx.canv._id, organizationId: c.organizationId, campaignId: c._id, passId: pass._id });
    ps.push(pass);
  }
  return { effort, passes: ps };
};

// Archived by hand: it can come back live (archivedFrom 'active', nothing live since).
const endedByHand = async (pass, { liveFrom, endedAt }) =>
  Pass.updateOne(
    { _id: pass._id },
    { $set: { status: 'archived', activatedAt: liveFrom, lastActivatedAt: liveFrom, archivedAt: endedAt, archivedFrom: 'active', archivedVia: 'pass', archivedBy: ctx.admin._id } }
  );

const invariants = async (effortId) => {
  const effort = await Effort.findById(effortId).lean();
  const live = await Pass.countDocuments({ effortId, status: 'active' });
  assert.ok(live <= 1, `never two live passes on one walk list (found ${live})`);
  assert.ok(!(effort.status === 'archived' && live > 0), 'never an archived walk list with a live pass');
  assert.strictEqual(effort.lifecycleLock?.lockedAt ?? null, null, 'the lifecycle lock is released');
  assert.strictEqual(await Pass.countDocuments({ effortId, 'recutLock.lockedAt': { $ne: null } }), 0, 'every recut lock is released');
  return { effort, live };
};

const fire = async (a, b, i) => {
  // Alternate which request leaves first, and stagger the second by 0, 3 or 80 ms, so both orders,
  // the overlap (lifecycle-busy) and the back-to-back case (the next rule refuses) all get exercised.
  const jitter = [0, 0, 3, 3, 80, 80][i % 6];
  if (i % 2) {
    const [rb, ra] = await Promise.all([b(), sleep(jitter).then(a)]);
    return [ra, rb];
  }
  return Promise.all([a(), sleep(jitter).then(b)]);
};

const tallies = {};
const tally = (name, key) => {
  tallies[name] = tallies[name] || {};
  tallies[name][key] = (tallies[name][key] || 0) + 1;
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, CampaignAssignment, CampaignChange, Effort, Pass, Turf, TurfAssignment, Household]) {
    await M.deleteMany({});
  }
  const org = await Organization.create({ name: 'Race Org', slug: 'race-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'race-a@t.co', passwordHash: 'x', isActive: true });
  const other = await User.create({ firstName: 'Abe', lastName: 'Admin', email: 'race-b@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'race-c@t.co', passwordHash: 'x', isActive: true });
  for (const [u, role] of [[admin, 'admin'], [other, 'admin'], [canv, 'canvasser']]) {
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
  }
  const campaign = await Campaign.create({ organizationId: org._id, name: 'Race C', type: 'lit_drop', state: 'TX', timeZone: 'America/Chicago', isActive: true });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: campaign._id, userId: canv._id });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, admin, other, canv, campaign, adminTok: signUserToken(admin), otherTok: signUserToken(other) });
});

after(async () => {
  console.log(`# race outcomes: ${JSON.stringify(tallies)}`);
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('archiving a walk list while a bring-back of one of its passes runs: never an archived walk list with a live pass', { skip }, async () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const w = await seedWalkList(`Race A ${i}`);
    const [p1] = w.passes;
    await endedByHand(p1, { liveFrom: new Date(Date.now() - 7200_000), endedAt: new Date(Date.now() - 3600_000) });
    const was = await fresh(Pass, p1);

    const [ra, rb] = await fire(
      () => call('POST', efforts(`/${w.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } }),
      () => call('POST', passes(`/${p1._id}/bring-back`), asOther()),
      i
    );
    tally('archive+bringBack', `${outcome(ra)} | ${outcome(rb)}`);
    const { effort } = await invariants(w.effort._id);
    const p = await fresh(Pass, p1);

    if (ra.status === 200 && rb.status === 409) {
      // The archive ran first (or alone): the bring-back changed nothing.
      assert.ok(['lifecycle-busy', 'walk-list-archived'].includes(rb.json.code), show(rb));
      assert.strictEqual(effort.status, 'archived');
      assert.strictEqual(p.status, 'archived');
      assert.strictEqual(p.archivedVia, 'pass');
      assert.strictEqual(ms(p.archivedAt), ms(was.archivedAt), "the losing bring-back left the pass's end alone");
      assert.strictEqual(effort.endedPassId, null, 'nothing was live to end');
    } else if (ra.status === 409 && rb.status === 200) {
      assert.strictEqual(ra.json.code, 'lifecycle-busy', show(ra));
      assert.strictEqual(effort.status, 'active', 'the losing archive changed nothing');
      assert.strictEqual(effort.archivedAt, null);
      assert.strictEqual(effort.endedPassId, null);
      assert.strictEqual(p.status, 'active');
    } else if (ra.status === 200 && rb.status === 200) {
      // The bring-back ran first; the archive then ended the pass again, and remembers it.
      assert.strictEqual(effort.status, 'archived');
      assert.strictEqual(String(effort.endedPassId), String(p1._id));
      assert.strictEqual(p.status, 'archived');
      assert.strictEqual(p.archivedVia, 'walk-list');
    } else {
      assert.fail(`unexpected outcome: archive ${show(ra)} / bring-back ${show(rb)}`);
    }
  }
});

test('two bring-backs of two archived passes of one walk list: one comes back live, the other is refused', { skip }, async () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const w = await seedWalkList(`Race B ${i}`);
    const [p1, p2] = w.passes;
    // Both could come back live on their own: neither was live after the other ended (pre-index data
    // where both were live, then each archived by hand).
    await endedByHand(p1, { liveFrom: new Date(Date.now() - 4 * 3600_000), endedAt: new Date(Date.now() - 3600_000) });
    await endedByHand(p2, { liveFrom: new Date(Date.now() - 5 * 3600_000), endedAt: new Date(Date.now() - 1800_000) });
    const was1 = await fresh(Pass, p1);
    const was2 = await fresh(Pass, p2);

    const [r1, r2] = await fire(
      () => call('POST', passes(`/${p1._id}/bring-back`), asAdmin()),
      () => call('POST', passes(`/${p2._id}/bring-back`), asOther()),
      i
    );
    tally('bringBack+bringBack', `${outcome(r1)} | ${outcome(r2)}`);
    const { live } = await invariants(w.effort._id);
    assert.strictEqual(live, 1, 'exactly one came back');
    const winners = [r1, r2].filter((r) => r.status === 200);
    assert.strictEqual(winners.length, 1, `one winner: ${show(r1)} / ${show(r2)}`);
    const [loserRes, loserWas] = r1.status === 200 ? [r2, was2] : [r1, was1];
    assert.strictEqual(loserRes.status, 409, show(loserRes));
    assert.ok(['lifecycle-busy', 'later-pass-went-live', 'another-pass-live'].includes(loserRes.json.code), show(loserRes));
    const loser = await Pass.findById(loserWas._id).lean();
    assert.strictEqual(loser.status, 'archived', 'the loser stays archived');
    assert.strictEqual(ms(loser.archivedAt), ms(loserWas.archivedAt), 'and unchanged');
    assert.strictEqual(loser.archivedVia, 'pass');
  }
});

test('a bring-back racing an activation of another draft of the walk list: never two live passes', { skip }, async () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const w = await seedWalkList(`Race C ${i}`);
    const [p1, p2] = w.passes;
    await endedByHand(p1, { liveFrom: new Date(Date.now() - 7200_000), endedAt: new Date(Date.now() - 3600_000) });
    const was1 = await fresh(Pass, p1);

    const [rb, ra] = await fire(
      () => call('POST', passes(`/${p1._id}/bring-back`), asAdmin()),
      () => call('POST', passes(`/${p2._id}/activate`), asOther()),
      i
    );
    tally('bringBack+activate', `${outcome(rb)} | ${outcome(ra)}`);
    await invariants(w.effort._id);
    const one = await fresh(Pass, p1);
    const two = await fresh(Pass, p2);

    if (rb.status === 200 && ra.status === 409) {
      assert.strictEqual(ra.json.code, 'lifecycle-busy', show(ra));
      assert.strictEqual(one.status, 'active');
      assert.strictEqual(two.status, 'draft', 'the losing activation changed nothing');
      assert.strictEqual(two.activatedAt, null);
    } else if (rb.status === 409 && ra.status === 200) {
      assert.ok(['lifecycle-busy', 'later-pass-went-live'].includes(rb.json.code), show(rb));
      assert.strictEqual(two.status, 'active');
      assert.strictEqual(one.status, 'archived');
      assert.strictEqual(one.archivedVia, 'pass', 'the losing bring-back changed nothing');
      assert.strictEqual(ms(one.archivedAt), ms(was1.archivedAt));
    } else if (rb.status === 200 && ra.status === 200) {
      // The bring-back first; the activation then ended it as the next pass going live.
      assert.strictEqual(two.status, 'active');
      assert.strictEqual(one.status, 'archived');
      assert.strictEqual(one.archivedVia, 'next-pass');
      assert.strictEqual(String(one.endedByPassId), String(p2._id));
    } else {
      assert.fail(`unexpected outcome: bring-back ${show(rb)} / activate ${show(ra)}`);
    }
  }
});

test('two admins archiving the same walk list at once: one archive, one History row', { skip }, async () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const w = await seedWalkList(`Race D ${i}`);
    const act = await call('POST', passes(`/${w.passes[0]._id}/activate`), asAdmin());
    assert.strictEqual(act.status, 200, show(act));
    const [r1, r2] = await fire(
      () => call('POST', efforts(`/${w.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } }),
      () => call('POST', efforts(`/${w.effort._id}/archive`), { ...asOther(), body: { confirmArchive: true } }),
      i
    );
    tally('archive+archive', `${outcome(r1)} | ${outcome(r2)}`);
    const { effort } = await invariants(w.effort._id);
    assert.strictEqual([r1, r2].filter((r) => r.status === 200).length, 1, `${show(r1)} / ${show(r2)}`);
    const loser = r1.status === 200 ? r2 : r1;
    assert.ok(['lifecycle-busy', 'already-archived'].includes(loser.json.code), show(loser));
    assert.strictEqual(effort.status, 'archived');
    assert.strictEqual(String(effort.endedPassId), String(w.passes[0]._id));
    assert.strictEqual(
      await CampaignChange.countDocuments({ campaignId: ctx.campaign._id, field: 'walkListArchived', 'details.walkList': `Race D ${i}` }),
      1,
      'exactly one History row'
    );
  }
});

test('Unarchive with bringBack racing a book operation on the pass: open-with-ended-pass at worst, never archived-with-live', { skip }, async () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const w = await seedWalkList(`Race E ${i}`);
    const [p1] = w.passes;
    assert.strictEqual((await call('POST', passes(`/${p1._id}/activate`), asAdmin())).status, 200);
    assert.strictEqual((await call('POST', efforts(`/${w.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } })).status, 200);

    let grabbed = false;
    const [ru] = await Promise.all([
      call('POST', efforts(`/${w.effort._id}/unarchive`), { ...asAdmin(), body: { bringBack: true } }),
      // A discard / restore taking the pass's recut lock somewhere in the middle.
      sleep(i * 2).then(async () => {
        grabbed = await acquireRecutLock(p1._id, ctx.admin._id);
      }),
    ]);
    if (grabbed) await releaseRecutLock(p1._id);
    const kind = ru.status === 200 ? (ru.json.bringBackError ? `200 bringBackError ${ru.json.bringBackError.code}` : '200 brought back') : outcome(ru);
    tally('unarchive+recutLock', `${kind} | lock ${grabbed ? 'taken' : 'refused'}`);
    const { effort } = await invariants(w.effort._id);
    const p = await fresh(Pass, p1);

    if (ru.status === 409) {
      assert.strictEqual(ru.json.code, 'recut-locked', show(ru));
      assert.strictEqual(effort.status, 'archived', 'a refused unarchive changed nothing');
      assert.strictEqual(String(effort.endedPassId), String(p1._id));
      assert.strictEqual(p.status, 'archived');
    } else if (ru.json.bringBackError) {
      assert.strictEqual(effort.status, 'active', 'reopened first');
      assert.strictEqual(p.status, 'archived');
      assert.match(ru.json.bringBackError.error, /is unarchived, but Pass 1 couldn't come back/);
    } else {
      // The book operation was refused while the bring-back held the lock, or took it afterwards.
      assert.strictEqual(ru.status, 200, show(ru));
      assert.strictEqual(effort.status, 'active');
      assert.strictEqual(p.status, 'active');
    }
  }
});
