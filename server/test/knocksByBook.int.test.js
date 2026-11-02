import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// One pass by book ("knocks by book" — the campaign Home's By book table and its CSV), over the REAL
// Express app and a throwaway mongod:
//   npm run test:int -- test/knocksByBook.int.test.js
// The promises this pins:
//   · a knock counts in the book it was recorded in, once per door per pass (a same-door double knock
//     once, a desk restricted mark never), and a door moved between books mid-pass once, in the book of
//     its latest knock;
//   · knocks with no live book (none, or a merged-away book) and their surveys land in one "not in a
//     book" row, and nothing from another pass appears;
//   · the books, that row and the totals add up — and the totals equal that pass's By pass row, with no
//     filter, a date window, a crew, and "No coordinator" with and without the walk-list filter (a lead who
//     runs a crew on another walk list and knocks this one herself), and an independent pipeline run;
//   · doors are the book's doors now, canvassers who is assigned now, books in natural order (2 before 10);
//   · the CSV carries the same rows and a TOTAL; ?passId is required, a pass of another campaign is not
//     found, and a lead reads only a campaign they manage.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-knocks-by-book';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { knocksPipeline } = await import('../src/services/reports/aggregations.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// Campaign days are America/Chicago; every timestamp sits mid-day there. Pass 2's knocks are on DAY2,
// one more on DAY3 (for the window), Pass 1's on DAY1.
const DAY1 = '2026-06-10';
const DAY2 = '2026-06-12';
const DAY3 = '2026-06-13';
const at = (day, hh) => new Date(`${day}T${hh}:00:00Z`);

const hh = (orgId, campaignId, effortId, n) => ({
  organizationId: orgId,
  campaignId,
  effortId,
  addressLine1: `${n} Book Rd`,
  city: 'Town',
  state: 'TX',
  zipCode: '75701',
  normalizedAddress: `${n} BOOK RD|TOWN|TX|75701`,
  location: { type: 'Point', coordinates: [-95.3 + n * 0.001, 32.35] },
  isActive: true,
  status: 'unknocked',
});

const act = (home, user, actionType, pass, turf, ts, extra = {}) => ({
  organizationId: home.organizationId,
  campaignId: home.campaignId,
  householdId: home._id,
  effortId: home.effortId,
  userId: user._id,
  actionType,
  location: { lat: 32.35, lng: -95.3, accuracy: 10 },
  distanceFromHouseMeters: 8,
  timestamp: ts,
  passId: pass._id,
  turfId: turf ? turf._id : null,
  coordinatorId: null,
  via: null,
  ...extra,
});

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignManager, Effort, Pass, Turf, TurfAssignment, Household, CanvassActivity, SurveyResponse, Subscription]) {
    await M.deleteMany({});
  }
  const org = await Organization.create({ name: 'Books Org', slug: 'books-org', isActive: true });
  const user = (first, last) => User.create({ firstName: first, lastName: last, email: `${first.toLowerCase()}@books.co`, passwordHash: 'x', isActive: true });
  const [admin, canvA, canvB, lead, otherLead, coach] = await Promise.all([
    user('Ada', 'Admin'), user('Al', 'Alpha'), user('Bo', 'Bravo'), user('Lee', 'Lead'), user('Ola', 'Other'), user('Cy', 'Coach'),
  ]);
  for (const [u, role] of [[admin, 'admin'], [canvA, 'canvasser'], [canvB, 'canvasser'], [lead, 'lead'], [otherLead, 'lead'], [coach, 'canvasser']]) {
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
  }
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Books C', type: 'survey', state: 'TX', isActive: true, timeZone: 'America/Chicago' });
  const otherCamp = await Campaign.create({ organizationId: org._id, name: 'Other C', type: 'survey', state: 'TX', isActive: true, timeZone: 'America/Chicago' });
  await CampaignManager.create({ campaignId: camp._id, userId: lead._id, organizationId: org._id, grantedBy: admin._id });
  await CampaignManager.create({ campaignId: otherCamp._id, userId: otherLead._id, organizationId: org._id, grantedBy: admin._id });

  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const south = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'South' });
  const otherEffort = await Effort.create({ organizationId: org._id, campaignId: otherCamp._id, name: 'Elsewhere' });
  const pass1 = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'archived' });
  const pass2 = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 2, name: 'Round 2', status: 'active' });
  const otherPass = await Pass.create({ organizationId: org._id, campaignId: otherCamp._id, effortId: otherEffort._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const southPass = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: south._id, roundNumber: 1, name: 'South 1', status: 'active' });

  const homes = await Household.insertMany([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => hh(org._id, camp._id, effort._id, n)));
  const [a1, a2, b1, b2, c1, d1, e1, f1, g1, h1] = homes;
  const [s1] = await Household.insertMany([hh(org._id, camp._id, south._id, 11)]);
  const book = (name, ids, status = 'published', pass = pass2) =>
    Turf.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, name, mode: 'manual', householdIds: ids, doorCount: ids.length, status });
  // Book 10 holds a1, a2, h1 and (after a mid-pass move) b2; Book 2 holds b1, e1, f1, g1 and one door nobody knocked.
  const book10 = await book('Book 10', [a1._id, a2._id, b2._id, h1._id]);
  const book2 = await book('Book 2', [b1._id, e1._id, f1._id, g1._id, new mongoose.Types.ObjectId()]);
  const merged = await book('Book 3 (merged)', [], 'archived');
  const pass1Book = await book('Old book', [a1._id], 'published', pass1);
  const southBook = await book('South book', [s1._id], 'published', southPass);
  const assign = (turf, u) => TurfAssignment.create({ turfId: turf._id, userId: u._id, organizationId: org._id, campaignId: camp._id, passId: pass2._id });
  await assign(book10, canvA);
  await assign(book2, canvB);
  await assign(book2, coach);

  await CanvassActivity.insertMany([
    act(a1, canvA, 'not_home', pass2, book10, at(DAY2, '15')),
    act(a2, canvA, 'survey_submitted', pass2, book10, at(DAY2, '15')),
    act(b1, canvB, 'refused', pass2, book2, at(DAY2, '16'), { coordinatorId: coach._id }),
    // b2: knocked in Book 2 by B's crew, moved, knocked again in Book 10 by A — once, in Book 10.
    act(b2, canvB, 'not_home', pass2, book2, at(DAY2, '16'), { coordinatorId: coach._id }),
    act(b2, canvA, 'not_home', pass2, book10, at(DAY2, '18')),
    act(c1, canvA, 'not_home', pass2, null, at(DAY2, '17')), // recorded with no book
    act(d1, canvA, 'not_home', pass2, merged, at(DAY2, '17')), // a book since merged away
    act(e1, admin, 'restricted', pass2, book2, at(DAY2, '17'), { via: 'bulk' }), // a desk mark: never a knock
    act(f1, canvB, 'not_home', pass2, book2, at(DAY2, '19'), { coordinatorId: coach._id }),
    act(f1, canvB, 'not_home', pass2, book2, at(DAY2, '20'), { coordinatorId: coach._id }), // same door twice
    act(g1, canvB, 'not_home', pass2, book2, at(DAY3, '16'), { coordinatorId: coach._id }), // outside a DAY2 window
    act(a1, canvA, 'not_home', pass1, pass1Book, at(DAY1, '15')), // another pass
    // The lead runs a crew on South (Bo knocks there under her) and knocks North's Book 10 herself, with no
    // coordinator: "No coordinator" counts her North knock only when the walk-list filter is North.
    act(s1, canvB, 'not_home', southPass, southBook, at(DAY2, '14'), { coordinatorId: lead._id }),
    act(h1, lead, 'not_home', pass2, book10, at(DAY2, '15')),
  ]);
  // Survey forms: a2's in Book 10, one with no book. Distinct voterIds: the ledger is unique per voter per pass.
  const form = (home, turf, ts, extra = {}) => ({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, householdId: home._id, voterId: new mongoose.Types.ObjectId(),
    userId: canvA._id, coordinatorId: null, surveyTemplateId: new mongoose.Types.ObjectId(), passId: pass2._id, turfId: turf ? turf._id : null,
    submittedAt: ts, answers: [], ...extra,
  });
  await SurveyResponse.collection.insertMany([form(a2, book10, at(DAY2, '15')), form(c1, null, at(DAY2, '17'))]);

  Object.assign(ctx, {
    org, camp, otherCamp, pass1, pass2, otherPass, coach, north: effort,
    admin: signUserToken(admin), lead: signUserToken(lead), otherLead: signUserToken(otherLead),
  });
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  if (URI) await mongoose.disconnect();
});

const get = async (path, token = ctx.admin) => {
  const res = await fetch(`${base}/api/admin/reports${path}`, { headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': String(ctx.org._id) } });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, json: type.includes('json') ? await res.json() : null, text: type.includes('csv') ? await res.text() : null };
};
const qs = (extra = {}) => `?${new URLSearchParams({ campaignId: String(ctx.camp._id), passId: String(ctx.pass2._id), ...extra })}`;
const COUNTS = ['knocks', 'surveyedKnocks', 'surveysTaken', 'litKnocks', 'refusedKnocks', 'noSolicitingKnocks', 'notTargetKnocks', 'contactKnocks', 'billableDoors', 'restrictedDoors'];
const sumRows = (rows, f) => rows.reduce((n, r) => n + (r?.[f] || 0), 0);

test('each knock counts in its book, once per door; no book and merged books are one row; other passes stay out', { skip }, async () => {
  const res = await get(`/knocks-by-book${qs()}`);
  assert.strictEqual(res.status, 200);
  const { books, notInBook, totals, pass } = res.json;
  assert.deepStrictEqual(books.map((b) => b.name), ['Book 2', 'Book 10'], 'natural order; the merged stub is not a book');
  assert.strictEqual(pass.roundLabel, 'Pass 2 · Round 2');
  assert.strictEqual(pass.effortName, 'North');
  const [two, ten] = books;
  assert.strictEqual(two.knocks, 3, 'b1, f1 once, g1 — b2 moved out, the desk mark is no knock');
  assert.strictEqual(two.refusedKnocks, 1);
  assert.strictEqual(two.contactKnocks, 1);
  assert.strictEqual(two.doors, 5, "the book's doors now");
  assert.deepStrictEqual(two.canvassers, ['Bo Bravo', 'Cy Coach']);
  assert.strictEqual(ten.knocks, 4, 'a1, a2, h1 and the moved b2');
  assert.strictEqual(ten.surveyedKnocks, 1);
  assert.strictEqual(ten.surveysTaken, 1);
  assert.strictEqual(ten.connectionRate, 25);
  assert.strictEqual(ten.doors, 4);
  assert.deepStrictEqual(ten.canvassers, ['Al Alpha']);
  assert.ok(notInBook, 'there is a not-in-a-book row');
  assert.strictEqual(notInBook.knocks, 2, 'c1 with no book, d1 in the merged book');
  assert.strictEqual(notInBook.surveysTaken, 1);
  assert.strictEqual(totals.knocks, 9);
  assert.strictEqual(totals.doors, 9);
  for (const f of COUNTS) assert.strictEqual(sumRows([...books, notInBook], f), totals[f], `rows add up: ${f}`);
});

test("the totals are that pass's By pass row — no filter, a window, a crew, No coordinator with and without a walk list", { skip }, async () => {
  const north = String(ctx.north._id);
  for (const extra of [
    {},
    { from: DAY2, to: DAY2 },
    { coordinatorId: String(ctx.coach._id) },
    { coordinatorId: 'none' },
    { coordinatorId: 'none', effortId: north },
    { effortId: north },
  ]) {
    const [byBook, byPass] = await Promise.all([
      get(`/knocks-by-book${qs(extra)}`),
      get(`/knocks-by-pass?${new URLSearchParams({ campaignId: String(ctx.camp._id), ...extra })}`),
    ]);
    const row = byPass.json.rounds.find((r) => r.passId === String(ctx.pass2._id));
    const label = JSON.stringify(extra);
    for (const f of COUNTS) assert.strictEqual(byBook.json.totals[f], row[f], `${label} ${f}`);
    assert.strictEqual(byBook.json.totals.connectionRate, row.connectionRate, `${label} connection rate`);
    const rows = [...byBook.json.books, byBook.json.notInBook].filter(Boolean);
    for (const f of COUNTS) assert.strictEqual(sumRows(rows, f), byBook.json.totals[f], `${label} rows add up: ${f}`);
  }
  // "No coordinator": the lead runs a crew (on South), so campaign-wide her own North knock is left out;
  // on North alone she runs no crew, and it counts — By pass and By book agree both ways (above).
  const none = await get(`/knocks-by-book${qs({ coordinatorId: 'none' })}`);
  const noneNorth = await get(`/knocks-by-book${qs({ coordinatorId: 'none', effortId: north })}`);
  assert.strictEqual(noneNorth.json.totals.knocks - none.json.totals.knocks, 1, "the lead's own knock, with the walk-list filter only");
  // The window drops g1 (DAY3); the crew filter keeps only the coach's crew — and b2 then counts in Book 2,
  // the latest of ITS rows.
  const day2 = await get(`/knocks-by-book${qs({ from: DAY2, to: DAY2 })}`);
  assert.strictEqual(day2.json.books[0].knocks, 2);
  const crew = await get(`/knocks-by-book${qs({ coordinatorId: String(ctx.coach._id) })}`);
  assert.deepStrictEqual(crew.json.books.map((b) => b.knocks), [4, 0]);
  assert.strictEqual(crew.json.notInBook, null, 'nothing of the crew landed outside a book');
  assert.strictEqual(crew.json.books[0].doors, 5, 'doors are not crew-scoped');
  // And against an independent run of the shared pipeline.
  const [direct] = await CanvassActivity.aggregate(
    knocksPipeline({ organizationId: ctx.org._id, campaignId: ctx.camp._id, passId: ctx.pass2._id }, { includeRestricted: true })
  );
  const all = await get(`/knocks-by-book${qs()}`);
  assert.strictEqual(all.json.totals.knocks, direct.knocks);
});

test('the CSV: every book with its canvassers and doors, the not-in-a-book row, and a TOTAL', { skip }, async () => {
  const res = await get(`/knocks-by-book.csv${qs()}`);
  assert.strictEqual(res.status, 200);
  const lines = res.text.trim().split(/\r?\n/);
  assert.match(lines[0], /^Walk list,Pass,Pass name,Book,Canvassers,Doors,Knocks,Survey doors,Surveys taken,Lit knocks,Refused,No soliciting,Connection rate %,Contact rate %$/);
  assert.match(lines[1], /^North,2,Round 2,Book 2,Bo Bravo; Cy Coach,5,3,/);
  assert.match(lines[2], /^North,2,Round 2,Book 10,Al Alpha,4,4,1,1,/);
  assert.match(lines[3], /^North,2,Round 2,Not in a book,,,2,/);
  assert.match(lines[4], /^TOTAL,,,,,9,9,/);
  assert.strictEqual(lines.length, 5);
});

test('passId is required, another campaign’s pass is not found, and a lead reads only a campaign they manage', { skip }, async () => {
  assert.strictEqual((await get(`/knocks-by-book?campaignId=${ctx.camp._id}`)).status, 400);
  assert.strictEqual((await get(`/knocks-by-book?campaignId=${ctx.camp._id}&passId=nope`)).status, 400);
  assert.strictEqual((await get(`/knocks-by-book${qs({ passId: String(ctx.otherPass._id) })}`)).status, 404);
  assert.strictEqual((await get(`/knocks-by-book${qs()}`, ctx.lead)).status, 200);
  assert.strictEqual((await get(`/knocks-by-book${qs()}`, ctx.otherLead)).status, 403);
  assert.strictEqual((await get(`/knocks-by-book.csv${qs()}`, ctx.otherLead)).status, 403);
});
