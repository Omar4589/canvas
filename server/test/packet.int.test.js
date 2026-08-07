import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// GET /admin/campaigns/:campaignId/packets/{sources,data} over the REAL Express app +
// throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/packet_test node --test test/packet.int.test.js
//
// Printable walk packets are PRINT-ONLY — nothing written on the paper comes back — so this
// suite is the only thing standing between a suppression bug and a volunteer knocking a door
// they were promised we would never send anyone to. It pins:
//   · WALK ORDER is Turf.householdIds' order. A `$in` does not preserve argument order, and
//     Household.walkOrder is deliberately set to a DIFFERENT sequence here so a regression to
//     "just sort by walkOrder" fails loudly. (routes/admin/turfs.js:1071 has the original bug.)
//   · SUPPRESSION is live and per-voter. A door with one flagged resident still prints, minus
//     that person, with NO marker where they were — a marker on paper outs the household to
//     whoever is holding it.
//   · RESTRICTED DOORS PRINT. 'restricted' is a door outcome, not a suppression.
//   · dateOfBirth NEVER leaves the server. The response carries a derived age instead — the
//     same trade voterPrivacy.int.test.js pins for the mobile wire.
//   · THE CAP REFUSES rather than truncating. A short packet means doors nobody knocks and,
//     because paper reports no coverage, nobody ever finds out.
// The packet is NOT an Export Center type, so exportBuilders.int.test.js's registry-driven
// DNC sweep gives it nothing. This file is its only coverage.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-packet';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SavedSearch } = await import('../src/models/SavedSearch.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { PACKET_DOOR_CAP } = await import('../src/services/packet/buildPacket.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const DOB = new Date('1978-04-02T00:00:00.000Z');

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass,
    Turf, TurfAssignment, Household, Voter, SurveyTemplate, SavedSearch, Subscription,
  ]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Packet Org', slug: 'packet-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'pa@t.co', passwordHash: 'x', isActive: true });
  const walker = await User.create({ firstName: 'Mia', lastName: 'Ochoa', email: 'pw@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: walker._id, organizationId: org._id, role: 'canvasser', isActive: true });

  // Campaign survey, plus an effort-level override to prove per-effort resolution.
  const campaignSurvey = await SurveyTemplate.create({
    organizationId: org._id, name: 'Campaign survey', isActive: true,
    questions: [
      { key: 'live', label: 'Live question', type: 'single_choice', order: 1,
        options: [
          { id: 'o1', text: 'Live option', order: 1 },
          { id: 'o2', text: 'Retired option', order: 2, retired: true },
        ] },
      { key: 'gone', label: 'Retired question', type: 'text', order: 2, retired: true },
    ],
  });
  const effortSurvey = await SurveyTemplate.create({
    organizationId: org._id, name: 'Effort survey', isActive: true,
    questions: [{ key: 'eff', label: 'Effort-only question', type: 'text', order: 1 }],
  });

  const camp = await Campaign.create({
    organizationId: org._id, name: 'Packet Campaign', type: 'survey', state: 'FL',
    isActive: true, surveyTemplateId: campaignSurvey._id,
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: walker._id });

  const effort = await Effort.create({
    organizationId: org._id, campaignId: camp._id, name: 'North', surveyTemplateId: effortSurvey._id,
  });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id,
    roundNumber: 2, name: 'Round 2', status: 'active',
  });

  let n = 0;
  const mkDoor = (label, extra = {}) =>
    Household.create({
      organizationId: org._id, campaignId: camp._id, effortId: effort._id,
      addressLine1: `${100 + n++} ${label} St`, city: 'Town', state: 'FL', zipCode: '34741',
      normalizedAddress: `${label}-${n}`,
      location: { type: 'Point', coordinates: [-81.4 + n * 0.001, 28.3] },
      isActive: true, ...extra,
    });

  const a = await mkDoor('Alpha');
  const b = await mkDoor('Bravo');
  const c = await mkDoor('Charlie');
  const restricted = await mkDoor('Restricted', { status: 'restricted' });
  const dncDoor = await mkDoor('AllDnc', { fullyDnc: true });
  const votedDoor = await mkDoor('AllVoted', { fullyVoted: true });
  const excluded = await mkDoor('Excluded', { excludedFromTurf: true });
  const inactive = await mkDoor('Inactive', { isActive: false });

  // Household.walkOrder is stamped in the OPPOSITE sequence to the book's own order, so a
  // regression that sorts by walkOrder — or that trusts $in's return order — is visible.
  const bookOrder = [c._id, a._id, restricted._id, b._id];
  await Promise.all(
    [a, b, c, restricted].map((h, i) => Household.updateOne({ _id: h._id }, { $set: { walkOrder: 99 - i, turfId: null } }))
  );

  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id,
    name: 'Ward 5 — Book C', mode: 'geometric', status: 'published',
    householdIds: [...bookOrder, dncDoor._id, votedDoor._id, excluded._id, inactive._id],
    doorCount: 8,
  });
  await TurfAssignment.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: walker._id,
  });

  // A second book in the SAME pass, created later. Its colour must be 1 (its position in the
  // pass) whether it is printed alone or alongside the first.
  const secondDoor = await mkDoor('Second');
  const turf2 = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id,
    name: 'Ward 5 — Book D', mode: 'geometric', status: 'published',
    householdIds: [secondDoor._id], doorCount: 1,
  });

  // Two residents at door A: one ordinary, one flagged do-not-contact. The door must print;
  // the flagged person must not; nothing may hint that anyone was removed.
  await Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: a._id,
    stateVoterId: 'SV-KEEP', firstName: 'Maria', lastName: 'Delgado', fullName: 'Maria Delgado',
    party: 'DEM', gender: 'F', dateOfBirth: DOB,
  });
  await Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: a._id,
    stateVoterId: 'SV-DNC', firstName: 'Dennis', lastName: 'Noncontact', fullName: 'Dennis Noncontact',
    party: 'REP', doNotContact: { flagged: true, reason: 'asked', source: 'admin' },
  });
  await Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: b._id,
    stateVoterId: 'SV-B', firstName: 'Bo', lastName: 'Bravo', fullName: 'Bo Bravo', phone: '7275550101',
  });
  await Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: c._id,
    stateVoterId: 'SV-C', firstName: 'Cal', lastName: 'Charlie', fullName: 'Cal Charlie',
  });

  // A saved search whose members include a coordinate-less door — it must still print, last.
  const noCoords = await Household.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id,
    addressLine1: '999 Nowhere St', city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: 'nowhere-999', location: null, isActive: true,
  });
  const list = await SavedSearch.create({
    organizationId: org._id, campaignId: camp._id, name: 'Saturday list', filter: {},
    householdIds: [noCoords._id, a._id, b._id], voterIds: [], householdCount: 3, voterCount: 3,
  });

  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, turf, turf2, pass, effort, a, b, c, restricted, dncDoor, votedDoor, excluded, inactive,
    noCoords, list, bookOrder, admin, walker, adminTok: signUserToken(admin), walkerTok: signUserToken(walker),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(path, { token, orgId } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const packet = (qs = '') =>
  call(`/admin/campaigns/${ctx.camp._id}/packets/data?turfIds=${ctx.turf._id}${qs}`, {
    token: ctx.adminTok, orgId: ctx.org._id,
  });

test('doors print in the BOOK\'s order, not $in order and not Household.walkOrder', { skip }, async () => {
  const { status, json } = await packet();
  assert.equal(status, 200);
  const printed = json.books[0].doors.map((d) => String(d.id));
  // The book's own sequence, minus the four suppressed doors at its tail.
  const expected = ctx.bookOrder.map(String);
  assert.deepEqual(printed, expected, 'walk order must follow Turf.householdIds');
  // walkOrder was stamped in reverse; if the query ever sorts by it, this catches it.
  assert.notDeepEqual(printed, [...expected].reverse());
  // Sequence numbers are 1..n over what actually printed, with no gaps where doors were cut.
  assert.deepEqual(json.books[0].doors.map((d) => d.seq), [1, 2, 3, 4]);
});

test('a restricted door PRINTS — restricted is an outcome, not a suppression', { skip }, async () => {
  const { json } = await packet();
  const ids = json.books[0].doors.map((d) => String(d.id));
  assert.ok(ids.includes(String(ctx.restricted._id)));
});

test('suppressed doors are absent and counted, with reasons that never reach the page', { skip }, async () => {
  const { json } = await packet();
  const book = json.books[0];
  const ids = new Set(book.doors.map((d) => String(d.id)));
  for (const [name, door] of [
    ['fullyDnc', ctx.dncDoor], ['fullyVoted', ctx.votedDoor],
    ['excludedFromTurf', ctx.excluded], ['inactive', ctx.inactive],
  ]) {
    assert.ok(!ids.has(String(door._id)), `${name} door must not print`);
  }
  assert.equal(book.omitted.total, 4);
  assert.equal(book.omitted.reasons.doNotContact, 1);
  assert.equal(book.omitted.reasons.alreadyVoted, 1);
  assert.equal(book.omitted.reasons.excluded, 1);
  assert.equal(book.omitted.reasons.inactive, 1);
});

test('a do-not-contact resident is dropped while their housemate\'s door still prints', { skip }, async () => {
  const { json } = await packet();
  const door = json.books[0].doors.find((d) => String(d.id) === String(ctx.a._id));
  assert.ok(door, 'the door must still print');
  const names = door.voters.map((v) => v.name);
  assert.ok(names.includes('Maria Delgado'));
  assert.ok(!names.includes('Dennis Noncontact'), 'a flagged resident must never print');
  assert.equal(door.voters.length, 1);
  // No marker, no placeholder, no count — the gap must be invisible on paper.
  const body = JSON.stringify(json);
  assert.ok(!body.includes('SV-DNC'));
  assert.ok(!/withheld/i.test(body));
});

test('dateOfBirth never leaves the server; an age does', { skip }, async () => {
  const { json } = await packet();
  const body = JSON.stringify(json);
  assert.ok(!body.includes('1978-04-02'), 'the raw date must not appear ANYWHERE in the payload');
  assert.ok(!body.includes('dateOfBirth'));
  const maria = json.books[0].doors
    .flatMap((d) => d.voters)
    .find((v) => v.name === 'Maria Delgado');
  assert.equal(typeof maria.age, 'number');
  assert.ok(maria.age > 40 && maria.age < 60);
});

test('phone is withheld unless explicitly asked for', { skip }, async () => {
  const off = await packet();
  assert.ok(!JSON.stringify(off.json).includes('7275550101'));
  const on = await packet('&includePhone=1');
  assert.ok(JSON.stringify(on.json).includes('7275550101'));
});

test('retired questions and options never reach the field', { skip }, async () => {
  const { json } = await packet();
  const survey = json.books[0].survey;
  // The book's pass belongs to an effort with its own survey, which must win over the
  // campaign's (services/packet/buildPacket.js surveyResolver).
  assert.equal(survey.name, 'Effort survey');
  assert.equal(survey.questions.length, 1);
  assert.equal(survey.questions[0].key, 'eff');
  const body = JSON.stringify(json);
  assert.ok(!body.includes('Retired question'));
  assert.ok(!body.includes('Retired option'));
});

test('a saved search prints, ordering a coordinate-less door last', { skip }, async () => {
  const { status, json } = await call(
    `/admin/campaigns/${ctx.camp._id}/packets/data?walkListId=${ctx.list._id}`,
    { token: ctx.adminTok, orgId: ctx.org._id }
  );
  assert.equal(status, 200);
  const ids = json.books[0].doors.map((d) => String(d.id));
  assert.equal(ids.length, 3);
  assert.equal(ids[ids.length - 1], String(ctx.noCoords._id), 'a door with no pin sorts last, but still prints');
  assert.equal(json.books[0].orderProvenance, 'computed');
  assert.ok(json.warnings.some((w) => /not stored/i.test(w)));
});

test('the sources list offers published books and saved searches', { skip }, async () => {
  const { status, json } = await call(`/admin/campaigns/${ctx.camp._id}/packets/sources`, {
    token: ctx.adminTok, orgId: ctx.org._id,
  });
  assert.equal(status, 200);
  assert.equal(json.cap, PACKET_DOOR_CAP);
  const round = json.rounds.find((r) => r.roundNumber === 2);
  assert.ok(round);
  // A campaign runs several walk lists in parallel, so a round must say which one it belongs
  // to — "Pass 3" alone is ambiguous when three walk lists each have a Pass 3.
  assert.equal(round.effortName, 'North');
  assert.equal(round.effortId, String(ctx.effort._id));
  assert.equal(round.books.length, 2);
  assert.equal(round.books[0].assignedTo, 'M. Ochoa');
  // Colour is the book's position within its PASS, in creation order — the same rule
  // TurfsPage uses, so the picker, the map and the printed stripe agree.
  assert.deepEqual(round.books.map((b) => b.colorIndex), [0, 1]);
  // The map needs geometry; a book cut without a boundary still lists, with null.
  assert.ok('boundary' in round.books[0] && 'centroid' in round.books[0]);
  assert.ok(json.walkLists.some((w) => w.name === 'Saturday list'));
});

test('book colour is stable — printing the 2nd book ALONE still colours it 2nd', { skip }, async () => {
  const { status, json } = await call(
    `/admin/campaigns/${ctx.camp._id}/packets/data?turfIds=${ctx.turf2._id}`,
    { token: ctx.adminTok, orgId: ctx.org._id }
  );
  assert.equal(status, 200);
  // Selection-relative colouring would make this 0 and the paper stripe would contradict
  // both the picker and the Turf Cutting map.
  assert.equal(json.books[0].colorIndex, 1);
});

test('an empty selection is a 400, never a silent whole-campaign print', { skip }, async () => {
  const { status } = await call(`/admin/campaigns/${ctx.camp._id}/packets/data?turfIds=`, {
    token: ctx.adminTok, orgId: ctx.org._id,
  });
  assert.equal(status, 400);
});

test('a canvasser cannot print — the gate is requireCampaignManager', { skip }, async () => {
  const { status } = await call(`/admin/campaigns/${ctx.camp._id}/packets/sources`, {
    token: ctx.walkerTok, orgId: ctx.org._id,
  });
  assert.ok(status === 403 || status === 404, `expected a refusal, got ${status}`);
});

test('over the cap the request is REFUSED, never truncated', { skip }, async () => {
  // A book of cap+1 knockable doors. The refusal has to carry the real count so the UI can
  // say something a human can act on.
  const org = ctx.org;
  const big = [];
  const docs = [];
  for (let i = 0; i <= PACKET_DOOR_CAP; i++) {
    docs.push({
      organizationId: org._id, campaignId: ctx.camp._id, effortId: ctx.effort._id,
      addressLine1: `${i} Big St`, city: 'Town', state: 'FL', zipCode: '34741',
      normalizedAddress: `big-${i}`, location: { type: 'Point', coordinates: [-81.5, 28.4] },
      isActive: true,
    });
  }
  const made = await Household.insertMany(docs);
  for (const h of made) big.push(h._id);
  const bigTurf = await Turf.create({
    organizationId: org._id, campaignId: ctx.camp._id, passId: ctx.pass._id,
    name: 'Huge', mode: 'geometric', status: 'published', householdIds: big, doorCount: big.length,
  });

  const { status, json } = await call(
    `/admin/campaigns/${ctx.camp._id}/packets/data?turfIds=${bigTurf._id}`,
    { token: ctx.adminTok, orgId: ctx.org._id }
  );
  assert.equal(status, 409);
  assert.equal(json.error, 'packet-too-large');
  assert.equal(json.doorCount, PACKET_DOOR_CAP + 1);
  assert.match(json.message, /two batches/i);
});
