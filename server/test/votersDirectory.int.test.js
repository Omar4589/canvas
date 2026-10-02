import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The voter directory after the 2026-09-30 incident fix — services/voters/voterDirectory.js
// (listVoters), the ONE query behind GET /admin/voters and the campaign-nested
// GET /admin/campaigns/:campaignId/voters — over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/voters_dir_test node --test test/votersDirectory.int.test.js
// A multi-campaign org's directory used to sort and $group EVERY org document per page load
// (24.6 s on a 325k-person org — Heroku's 30 s router answered 503). The fix is a BOUNDED
// PREFIX over a covering index: the first (skip + limit) × campaignCount rows in directory order
// are guaranteed to hold the page's people, because unique {campaignId, stateVoterId} caps a
// person at campaignCount rows. Locks:
//   1. Parity — the bounded page equals a whole-org JS recompute (filter THEN dedupe: the chips
//      are the campaigns of the MATCHING rows, surveyed means surveyed in a matching row, the
//      primary row is the min by lastName/firstName/_id) for every filter, three pages deep,
//      with the guard never firing.
//   2. The short-page guard — archived campaigns count toward the multiplier; rows orphaned by
//      a vanished Campaign doc can break the bound, and when they do the guard recomputes
//      unbounded and the page is still exact.
//   3. MaxTimeMSExpired → 503 DIRECTORY_TIMEOUT; any other failure stays a 500.
//   4. VOTER_DIRECTORY_MAX_MS reaches both aggregations, read at call time.
//   5. Both new indexes are declared with the exact key order buildIndexes.js diffs on.
//   6. The plan — the page pipeline rides the covering index: no SORT stage, zero documents.
//   7. The campaign-scoped branch stays a plain find — no chips, exact total.
//   8. Campaign parity — the campaign-nested route answers exactly what ?campaignId= answers,
//      and both are the campaign's own truth, for every filter.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-voters-directory';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { VotedVoter } = await import('../src/models/VotedVoter.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// The two key patterns release one adds to models/Voter.js, spelled the way buildIndexes.js
// diffs them (JSON.stringify of the keys) — a reordered key is a DIFFERENT index to Mongo and
// to the migration, so these pin the order, not just the membership.
const COVERING_KEYS = {
  organizationId: 1,
  lastName: 1,
  firstName: 1,
  _id: 1,
  stateVoterId: 1,
  campaignId: 1,
  surveyStatus: 1,
  party: 1,
  'doNotContact.flagged': 1,
};
const CAMPAIGN_KEYS = { organizationId: 1, campaignId: 1, lastName: 1, firstName: 1 };

// ── Fixture: ~40 people across Campaign A, Campaign B and an ARCHIVED, row-less Campaign C ──
// `in` names the campaigns holding a row; a shared person ('AB') has one row per campaign with
// the same name and svid (siblings). Deliberate shapes: lastB (the surname differs between
// campaigns — the primary is the min, whichever campaign it sits in), partyB (the party differs —
// a party filter matches ONE sibling, so the chips must shrink to it), surveyedIn (surveyed in
// one campaign only), dnc (flagged on BOTH siblings — the sibling invariant), votedA (a VotedVoter
// row for the A row), two different people both named Max Kim (the _id tie-break between people
// who share a name), and addresses shared by two people so an address search returns several
// doors. Svids are never substrings of one another. Abbott, Acker and Adler sort first on
// purpose — test 2 hangs its orphan rows on them.
const PEOPLE = [
  { svid: 'VD001', first: 'Alan', last: 'Abbott', party: 'D', addr: '12 Elm St', in: 'AB', surveyedIn: 'A' },
  { svid: 'VD002', first: 'Bea', last: 'Acker', party: 'R', addr: '12 Elm St', in: 'AB' },
  { svid: 'VD003', first: 'Cy', last: 'Adler', party: 'D', addr: '14 Elm St', in: 'AB' },
  { svid: 'VD004', first: 'Dana', last: 'Baker', party: 'NPA', addr: '20 Oak Ave', in: 'AB', dnc: true },
  { svid: 'VD005', first: 'Eli', last: 'Carter', party: 'R', addr: '22 Oak Ave', in: 'AB', surveyedIn: 'A' },
  { svid: 'VD006', first: 'Fay', last: 'Diaz', party: 'D', addr: '30 Pine Rd', in: 'AB' },
  { svid: 'VD007', first: 'Gus', last: 'Evans', party: null, addr: '30 Pine Rd', in: 'AB' },
  { svid: 'VD008', first: 'Hal', last: 'Foster', party: 'R', addr: '40 Cedar Ln', in: 'AB', dnc: true },
  { svid: 'VD009', first: 'Ivy', last: 'Garcia', party: 'D', addr: '42 Cedar Ln', in: 'AB', votedA: true },
  { svid: 'VD010', first: 'Jon', last: 'Hughes', party: 'NPA', addr: '50 Birch Ct', in: 'AB', surveyedIn: 'A' },
  { svid: 'VD011', first: 'Kay', last: 'Ingram', party: 'D', addr: '52 Birch Ct', in: 'AB', dnc: true },
  { svid: 'VD012', first: 'Lou', last: 'Jensen', party: 'R', addr: '60 Maple Dr', in: 'AB', votedA: true },
  { svid: 'VD013', first: 'Max', last: 'Kim', party: 'D', addr: '62 Maple Dr', in: 'AB' },
  { svid: 'VD014', first: 'Nia', last: 'Lopez', party: 'D', partyB: 'R', addr: '70 Walnut St', in: 'AB' },
  { svid: 'VD015', first: 'Ola', last: 'Morgan', party: 'NPA', addr: '72 Walnut St', in: 'AB', surveyedIn: 'A', votedA: true },
  { svid: 'VD016', first: 'Pat', last: 'Nguyen', party: 'D', addr: '80 Spruce Way', in: 'AB' },
  // The surname differs between campaigns: VD017's primary is the B row ('Smith' sorts before
  // 'Smith-Jones'), VD018's is the A row ('Reyes' before 'Reyes-Ortiz').
  { svid: 'VD017', first: 'Quinn', last: 'Smith-Jones', lastB: 'Smith', party: 'D', addr: '90 Ash St', in: 'AB' },
  { svid: 'VD018', first: 'Rae', last: 'Reyes', lastB: 'Reyes-Ortiz', party: 'R', addr: '92 Ash St', in: 'AB' },
  // A only.
  { svid: 'VD019', first: 'Ray', last: 'Olsen', party: 'D', addr: '100 Lake Rd', in: 'A', surveyedIn: 'A' },
  { svid: 'VD020', first: 'Sal', last: 'Perez', party: 'R', addr: '100 Lake Rd', in: 'A' },
  { svid: 'VD021', first: 'Tad', last: 'Quinn', party: 'NPA', addr: '102 Lake Rd', in: 'A', votedA: true },
  { svid: 'VD022', first: 'Uma', last: 'Rivera', party: 'D', addr: '110 Hill St', in: 'A' },
  { svid: 'VD023', first: 'Val', last: 'Stone', party: null, addr: '112 Hill St', in: 'A', surveyedIn: 'A' },
  { svid: 'VD024', first: 'Wes', last: 'Turner', party: 'R', addr: '120 River Rd', in: 'A' },
  { svid: 'VD025', first: 'Xia', last: 'Underwood', party: 'D', addr: '122 River Rd', in: 'A' },
  { svid: 'VD026', first: 'Yul', last: 'Vance', party: 'G', addr: '130 Elm St', in: 'A' },
  { svid: 'VD027', first: 'Zed', last: 'Walsh', party: 'R', addr: '132 Elm St', in: 'A' },
  { svid: 'VD028', first: 'Max', last: 'Kim', party: 'R', addr: '64 Maple Dr', in: 'A' }, // a second Max Kim
  // B only.
  { svid: 'VD029', first: 'Abe', last: 'Young', party: 'D', addr: '200 Elm St', in: 'B' },
  { svid: 'VD030', first: 'Bo', last: 'Zimmer', party: 'R', addr: '202 Elm St', in: 'B' },
  { svid: 'VD031', first: 'Cal', last: 'Brooks', party: 'NPA', addr: '210 Oak Ave', in: 'B', surveyedIn: 'B' },
  { svid: 'VD032', first: 'Dot', last: 'Cole', party: 'D', addr: '212 Oak Ave', in: 'B' },
  { svid: 'VD033', first: 'Eve', last: 'Dunn', party: 'R', addr: '220 Pine Rd', in: 'B' },
  { svid: 'VD034', first: 'Fin', last: 'Ellis', party: null, addr: '222 Pine Rd', in: 'B' },
  { svid: 'VD035', first: 'Gia', last: 'Flynn', party: 'D', addr: '230 Cedar Ln', in: 'B' },
  { svid: 'VD036', first: 'Hy', last: 'Grant', party: 'G', addr: '232 Cedar Ln', in: 'B' },
  { svid: 'VD037', first: 'Ida', last: 'Hart', party: 'D', addr: '240 Birch Ct', in: 'B' },
];
// Two walk-ups (typed at a door) on top: one per campaign. PEOPLE.length + 2 people in all.
const WALKUPS = 2;

// One Household per (campaign, address) — per-campaign doors, like the importer makes them.
const doors = new Map();
const doorFor = async (campaign, address) => {
  const key = `${campaign._id}|${address}`;
  if (!doors.has(key)) {
    doors.set(
      key,
      await Household.create({
        organizationId: ctx.org._id,
        campaignId: campaign._id,
        addressLine1: address,
        city: 'Springfield',
        state: 'IL',
        zipCode: '62704',
        normalizedAddress: `${address.toUpperCase()}|SPRINGFIELD|IL|62704`,
        isActive: true,
        status: 'unknocked',
      })
    );
  }
  return doors.get(key);
};

// A walk-up row exactly as routes/mobile/canvass.js writes one: a synthetic svid built from its
// OWN _id, provenance in doorAdded, no identity card.
const walkUp = async (campaign, first, last, address) => {
  const _id = new mongoose.Types.ObjectId();
  return Voter.create({
    _id,
    organizationId: ctx.org._id,
    campaignId: campaign._id,
    householdId: (await doorFor(campaign, address))._id,
    stateVoterId: `manual:${_id.toHexString()}`,
    personId: null,
    firstName: first,
    lastName: last,
    fullName: `${first} ${last}`,
    party: null,
    doorAdded: { byUserId: ctx.admin._id, at: new Date() },
  });
};

const rowIn = (campaign, svid) => Voter.findOne({ campaignId: campaign._id, stateVoterId: svid }).lean();

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
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};
const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });

// ── The oracle: the directory recomputed in JS from every org row ────────────────────────────
// Mongo's simple collation compares strings byte-wise, which for ASCII names is exactly JS `<`;
// ObjectIds compare the way their hex strings do.
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
const byDirectoryOrder = (a, b) =>
  cmp(a.lastName, b.lastName) || cmp(a.firstName, b.firstName) || cmp(String(a._id), String(b._id));
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The resolver's filter semantics, row by row — ONE predicate for both oracles below (the org one
// dedupes what it keeps; the campaign one counts rows). `households` and `votedIds` are the
// scope's doors and voted row ids: the resolver narrows its address lookup and its VotedVoter
// distinct to the campaign under a campaign scope, so each oracle hands in its own.
const rowFilter = (q, { households, votedIds }) => {
  const rx = q.search ? new RegExp(escapeRegex(q.search), 'i') : null;
  const addrHits = new Set(
    rx
      ? households
          .filter((h) => rx.test(h.addressLine1) || rx.test(h.city) || rx.test(h.zipCode))
          .map((h) => String(h._id))
      : []
  );
  return (r) => {
    if (q.party && r.party !== q.party) return false;
    if (q.surveyStatus && r.surveyStatus !== q.surveyStatus) return false;
    if (q.dnc === 'true' && r.doNotContact?.flagged !== true) return false;
    if (q.dnc === 'false' && r.doNotContact?.flagged === true) return false;
    if (q.doorAdded === 'true' && !(r.doorAdded && r.doorAdded.at !== undefined)) return false;
    if (q.voted === 'true' && !votedIds.has(String(r._id))) return false;
    if (q.voted === 'false' && votedIds.has(String(r._id))) return false;
    if (rx && !(rx.test(r.fullName) || r.stateVoterId === q.search || addrHits.has(String(r.householdId)))) return false;
    return true;
  };
};

// Mirrors the route's filter semantics row by row, then dedupes: per stateVoterId among the
// MATCHING rows, the primary is the min by (lastName, firstName, _id); people sort by that key;
// chips are the campaigns of the matching rows; surveyed means surveyed in one of them; total is
// the number of distinct svids among matching rows.
const oracle = async (q) => {
  const [rows, households, voted] = await Promise.all([
    Voter.find({ organizationId: ctx.org._id }).lean(),
    Household.find({ organizationId: ctx.org._id }).lean(),
    VotedVoter.find({ organizationId: ctx.org._id }).lean(),
  ]);
  const votedIds = new Set(voted.map((r) => String(r.voterId)));
  const matching = rows.filter(rowFilter(q, { households, votedIds }));
  const bySvid = new Map();
  for (const r of matching) {
    if (!bySvid.has(r.stateVoterId)) bySvid.set(r.stateVoterId, []);
    bySvid.get(r.stateVoterId).push(r);
  }
  const people = [...bySvid.values()]
    .map((group) => {
      const primary = [...group].sort(byDirectoryOrder)[0];
      return {
        id: String(primary._id),
        svid: primary.stateVoterId,
        lastName: primary.lastName,
        firstName: primary.firstName,
        campaigns: [...new Set(group.map((r) => String(r.campaignId)))].sort(),
        surveyStatus: group.some((r) => r.surveyStatus === 'surveyed') ? 'surveyed' : 'not_surveyed',
      };
    })
    .sort((a, b) => cmp(a.lastName, b.lastName) || cmp(a.firstName, b.firstName) || cmp(a.id, b.id));
  return { people, total: bySvid.size };
};

// The campaign view's truth: the campaign's MATCHING rows, no dedupe — total is a ROW count —
// against the campaign's own doors and its own VotedVoter rows. Ids come back sorted: the plain
// branch orders by name alone, so two rows of one name (A's two Max Kims) have no pinned order
// between them; the parity lock compares the two ROUTES' pages exactly and the oracle's
// membership as a set.
const campaignOracle = async (q, campaign) => {
  const [rows, households, voted] = await Promise.all([
    Voter.find({ organizationId: ctx.org._id, campaignId: campaign._id }).lean(),
    Household.find({ organizationId: ctx.org._id, campaignId: campaign._id }).lean(),
    VotedVoter.find({ organizationId: ctx.org._id, campaignId: campaign._id }).lean(),
  ]);
  const votedIds = new Set(voted.map((r) => String(r.voterId)));
  const matching = rows.filter(rowFilter(q, { households, votedIds }));
  return { ids: matching.map((r) => String(r._id)).sort(), total: matching.length };
};

// One page of the wire against one slice of the oracle: ids in order, total, chips, surveyStatus.
const assertPageMatches = (res, want, total, label) => {
  assert.strictEqual(res.status, 200, `${label}: 200`);
  assert.strictEqual(res.json.total, total, `${label}: total`);
  assert.deepStrictEqual(res.json.voters.map((v) => v.id), want.map((p) => p.id), `${label}: ids in order`);
  res.json.voters.forEach((v, i) => {
    assert.ok(Array.isArray(v.campaigns), `${label}: deduped rows carry campaign chips`);
    assert.deepStrictEqual(v.campaigns.map((c) => c.id).sort(), want[i].campaigns, `${label}: chips of ${v.stateVoterId}`);
    assert.strictEqual(v.surveyStatus, want[i].surveyStatus, `${label}: surveyStatus of ${v.stateVoterId}`);
  });
};

// Captures the guard's console.warn lines (only those) while `fn` runs; everything else passes
// through. The app runs in-process, so the route's console IS this console.
const spyWarns = async (fn) => {
  const warns = [];
  const orig = console.warn;
  console.warn = (...args) => {
    const line = args.map(String).join(' ');
    if (line.startsWith('[voters] directory prefix under-delivered')) warns.push(line);
    else orig(...args);
  };
  try {
    return { result: await fn(), warns };
  } finally {
    console.warn = orig;
  }
};

// Stands in for Voter.aggregate while `fn` runs (the exportBuilders.int.test.js pattern — a
// hasOwnProperty-guarded restore, since `aggregate` is inherited from Model, not own). Every
// call returns a thenable with the chain the route uses (.allowDiskUse().option()) that settles
// the way `settle` says, and the options each call received are recorded.
const withAggregateStub = async (settle, fn) => {
  const optionCalls = [];
  const own = Object.prototype.hasOwnProperty.call(Voter, 'aggregate');
  const orig = Voter.aggregate;
  Voter.aggregate = () => {
    const fake = {
      allowDiskUse: () => fake,
      option: (o) => {
        optionCalls.push(o);
        return fake;
      },
      then: (res, rej) => settle().then(res, rej),
    };
    return fake;
  };
  try {
    return { result: await fn(), optionCalls };
  } finally {
    if (own) Voter.aggregate = orig;
    else delete Voter.aggregate;
  }
};

// The same stand-in for Voter.countDocuments — the plain branch's page count, the one capped
// Voter call a campaign-scoped page makes that a test can make expire (that branch never
// aggregates). A thenable with the `.maxTimeMS()` chain the resolver uses.
const withCountStub = async (settle, fn) => {
  const own = Object.prototype.hasOwnProperty.call(Voter, 'countDocuments');
  const orig = Voter.countDocuments;
  Voter.countDocuments = () => {
    const fake = { maxTimeMS: () => fake, then: (res, rej) => settle().then(res, rej) };
    return fake;
  };
  try {
    return { result: await fn() };
  } finally {
    if (own) Voter.countDocuments = orig;
    else delete Voter.countDocuments;
  }
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  // The covering index and the per-campaign unique index are the mechanisms under test — build
  // them for real (prod autoIndex is OFF; here syncIndexes stands in for migrate:build-indexes).
  await Promise.all([Voter.syncIndexes(), Household.syncIndexes()]);
  for (const M of [Organization, Subscription, User, Membership, Campaign, Household, Voter, VotedVoter]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Directory Org', slug: 'directory-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'vd@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const campA = await Campaign.create({ organizationId: org._id, name: 'Campaign A', type: 'survey', state: 'IL', isActive: true });
  const campB = await Campaign.create({ organizationId: org._id, name: 'Campaign B', type: 'survey', state: 'IL', isActive: true });
  // Archived and row-less. Its doc still counts toward campaignCount — and so toward the prefix
  // multiplier — which test 2 depends on.
  const campC = await Campaign.create({
    organizationId: org._id, name: 'Campaign C', type: 'survey', state: 'IL', isActive: false, archivedAt: new Date(),
  });
  Object.assign(ctx, { org, admin, campA, campB, campC, adminTok: signUserToken(admin) });

  // A row per campaign the person is in; A before B, so a shared person's A row has the smaller
  // _id (the oracle never assumes this — it computes the min).
  const rows = [];
  for (const p of PEOPLE) {
    for (const letter of p.in) {
      const camp = letter === 'A' ? campA : campB;
      const lastName = letter === 'B' && p.lastB ? p.lastB : p.last;
      const party = letter === 'B' && 'partyB' in p ? p.partyB : p.party;
      rows.push({
        organizationId: org._id,
        campaignId: camp._id,
        householdId: (await doorFor(camp, p.addr))._id,
        stateVoterId: p.svid,
        firstName: p.first,
        lastName,
        fullName: `${p.first} ${lastName}`,
        party,
        surveyStatus: p.surveyedIn === letter ? 'surveyed' : 'not_surveyed',
        doNotContact: p.dnc
          ? { flagged: true, at: new Date(), byUserId: admin._id, reason: 'Fixture: asked us to stop', source: 'admin', uploadId: null }
          : null,
      });
    }
  }
  await Voter.insertMany(rows);
  await walkUp(campA, 'Walkup', 'Zane', '22 Oak Ave');
  await walkUp(campB, 'Walkin', 'Zane', '210 Oak Ave');

  // Early votes recorded in A for the votedA people (one upload).
  const uploadId = new mongoose.Types.ObjectId();
  const votedRows = [];
  for (const p of PEOPLE.filter((x) => x.votedA)) {
    const a = await rowIn(campA, p.svid);
    votedRows.push({ organizationId: org._id, campaignId: campA._id, voterId: a._id, householdId: a.householdId, stateVoterId: p.svid, uploadId });
  }
  await VotedVoter.insertMany(votedRows);

  // A separate org for the plan pin (test 6): 500 people × 2 campaigns, unique names so a
  // person's two rows sit together in directory order. Only an id — the pipeline is run directly
  // there, never through the route, so no Campaign or Household docs are needed.
  const SURNAMES = ['Adams', 'Brown', 'Chen', 'Davis', 'Edwards', 'Fischer', 'Gomez', 'Hill', 'Ito', 'Jones', 'Khan', 'Lee', 'Miller', 'Novak', 'Ortiz', 'Patel', 'Quist', 'Ross', 'Singh', 'Tran', 'Usman', 'Vogel', 'Wright', 'Xu', 'Yang', 'Zhao'];
  ctx.planOrgId = new mongoose.Types.ObjectId();
  const planCamps = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const planHh = new mongoose.Types.ObjectId();
  const planRows = [];
  for (let i = 0; i < 500; i++) {
    const lastName = SURNAMES[i % SURNAMES.length];
    const firstName = `P${String(i).padStart(4, '0')}`;
    for (const campaignId of planCamps) {
      planRows.push({
        organizationId: ctx.planOrgId, campaignId, householdId: planHh, stateVoterId: `PLAN${i}`,
        firstName, lastName, fullName: `${firstName} ${lastName}`, party: i % 3 ? 'D' : 'R',
      });
    }
  }
  await Voter.insertMany(planRows);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

// The filter matrix both parity locks walk (tests 1 and 8): [query, expected ORG total where the
// fixture makes it hand-countable — a self-check that the case exercises what it claims, since
// oracle and route could agree on an empty page]. The totals are the org-wide, deduped ones; the
// campaign lock takes its truth from campaignOracle instead.
const ORACLE_CASES = [
  [{}, PEOPLE.length + WALKUPS],
  [{ surveyStatus: 'surveyed' }, 7],
  [{ surveyStatus: 'not_surveyed' }, 36],
  [{ party: 'D' }, 16],
  [{ party: 'R' }, 12],
  [{ dnc: 'true' }, 3],
  [{ dnc: 'false' }, 36],
  [{ voted: 'false' }, PEOPLE.length + WALKUPS - 1], // Quinn's only row voted; the shared voters keep their B row
  [{ voted: 'true' }, 4],
  [{ doorAdded: 'true' }, WALKUPS],
  [{ search: 'Kim' }, 2], // a last-name fragment: both Max Kims
  [{ search: 'Elm' }, 7], // an address fragment: six Elm St doors across both campaigns
  [{ search: 'er' }], // names AND an address (River Rd) through the same $or
  [{ search: 'VD013' }, 1], // exact svid
  [{ party: 'D', surveyStatus: 'not_surveyed' }],
  [{ dnc: 'false', voted: 'false', search: 'Elm' }],
];

// ── 1. Parity ───────────────────────────────────────────────────────────────────

test('1. parity: the bounded page equals a whole-org recompute for every filter, three pages deep, guard silent', { skip }, async () => {
  const { warns } = await spyWarns(async () => {
    for (const [query, expectedTotal] of ORACLE_CASES) {
      const label = JSON.stringify(query);
      const { people, total } = await oracle(query);
      assert.strictEqual(people.length, total, `${label}: oracle is self-consistent`);
      if (expectedTotal !== undefined) assert.strictEqual(total, expectedTotal, `${label}: fixture self-check`);
      for (const skipN of [0, 5, 10]) {
        const qs = new URLSearchParams({ ...query, limit: '5', skip: String(skipN) }).toString();
        const res = await call('GET', `/admin/voters?${qs}`, asAdmin());
        assertPageMatches(res, people.slice(skipN, skipN + 5), total, `${label} skip ${skipN}`);
        assert.strictEqual(res.json.limit, 5);
        assert.strictEqual(res.json.skip, skipN);
      }
    }
  });
  assert.deepStrictEqual(warns, [], 'the prefix bound held on every page — the guard is a backstop, never the mechanism');
});

test('1b. filter-then-dedupe, spelled out: chips shrink to the matching rows and the primary moves with them', { skip }, async () => {
  const A = String(ctx.campA._id);
  const B = String(ctx.campB._id);
  const find = (res, svid) => res.json.voters.find((v) => v.stateVoterId === svid);
  const chips = (v) => v.campaigns.map((c) => c.id).sort();
  const both = [A, B].sort();

  const all = await call('GET', '/admin/voters?limit=200', asAdmin());
  assert.strictEqual(all.status, 200);
  assert.strictEqual(all.json.total, PEOPLE.length + WALKUPS);
  const abbott = find(all, 'VD001');
  assert.strictEqual(abbott.surveyStatus, 'surveyed', 'surveyed in A reads surveyed org-wide');
  assert.deepStrictEqual(chips(abbott), both);
  assert.strictEqual(abbott.id, String((await rowIn(ctx.campA, 'VD001'))._id), 'the A row (same name, smaller _id) is the primary');
  assert.deepStrictEqual(chips(abbott).map((id) => all.json.voters.find((v) => v.stateVoterId === 'VD001').campaigns.find((c) => c.id === id).name).sort(), ['Campaign A', 'Campaign B'], 'chips carry campaign names');
  // The surname differs between campaigns: the directory row IS the min-sorting sibling.
  const smith = find(all, 'VD017');
  assert.strictEqual(smith.lastName, 'Smith', 'the B row sorts first, so it is the directory row');
  assert.strictEqual(smith.id, String((await rowIn(ctx.campB, 'VD017'))._id));
  const reyes = find(all, 'VD018');
  assert.strictEqual(reyes.lastName, 'Reyes', 'the A row sorts first here');
  assert.strictEqual(reyes.id, String((await rowIn(ctx.campA, 'VD018'))._id));
  // Two different people named Max Kim: two rows, adjacent, ordered by primary _id.
  const kims = all.json.voters.filter((v) => v.fullName === 'Max Kim');
  assert.strictEqual(kims.length, 2, 'different people are never merged by name');
  const kimIdx = kims.map((k) => all.json.voters.indexOf(k));
  assert.strictEqual(kimIdx[1], kimIdx[0] + 1, 'adjacent in the directory');
  assert.ok(kims[0].id < kims[1].id, 'and tie-broken by _id');
  // The walk-ups: synthetic svid, badge on, no chips beyond their one campaign.
  const walk = all.json.voters.filter((v) => v.stateVoterId.startsWith('manual:'));
  assert.strictEqual(walk.length, WALKUPS);
  for (const w of walk) {
    assert.ok(w.doorAdded?.at, 'walk-up badge');
    assert.strictEqual(w.campaigns.length, 1);
  }
  // Only rows the filter MATCHES contribute: Abbott's B row is the not_surveyed one.
  const ns = await call('GET', '/admin/voters?surveyStatus=not_surveyed&limit=200', asAdmin());
  const abbottNs = find(ns, 'VD001');
  assert.deepStrictEqual(chips(abbottNs), [B], 'only the not_surveyed sibling matched');
  assert.strictEqual(abbottNs.surveyStatus, 'not_surveyed', 'surveyed-in-any reads over MATCHING rows only');
  assert.strictEqual(abbottNs.id, String((await rowIn(ctx.campB, 'VD001'))._id), 'and the primary is that row');
  assert.strictEqual(find(await call('GET', '/admin/voters?surveyStatus=surveyed&limit=200', asAdmin()), 'VD001').id, abbott.id);
  // Party differs between siblings: each filter sees ONE row.
  const dems = await call('GET', '/admin/voters?party=D&limit=200', asAdmin());
  assert.deepStrictEqual(chips(find(dems, 'VD014')), [A]);
  const reps = await call('GET', '/admin/voters?party=R&limit=200', asAdmin());
  assert.deepStrictEqual(chips(find(reps, 'VD014')), [B]);
  assert.strictEqual(find(reps, 'VD014').id, String((await rowIn(ctx.campB, 'VD014'))._id));
  // voted: a vote on the A row hides the A row only; a person whose ONLY row voted disappears.
  const notVoted = await call('GET', '/admin/voters?voted=false&limit=200', asAdmin());
  assert.deepStrictEqual(chips(find(notVoted, 'VD009')), [B], 'Garcia stays via the un-voted B row');
  assert.strictEqual(find(notVoted, 'VD021'), undefined, 'Quinn (A only, voted) is gone');
  assert.strictEqual(notVoted.json.total, PEOPLE.length + WALKUPS - 1);
  const votedRes = await call('GET', '/admin/voters?voted=true&limit=200', asAdmin());
  assert.strictEqual(votedRes.json.total, 4);
  for (const v of votedRes.json.voters) assert.deepStrictEqual(chips(v), [A]);
  // dnc: flagged on both siblings, so both chips survive the filter.
  const dnc = await call('GET', '/admin/voters?dnc=true&limit=200', asAdmin());
  assert.strictEqual(dnc.json.total, 3);
  for (const v of dnc.json.voters) {
    assert.strictEqual(v.dnc, true);
    assert.deepStrictEqual(chips(v), both);
  }
  const notDnc = await call('GET', '/admin/voters?dnc=false&limit=200', asAdmin());
  assert.ok(notDnc.json.voters.every((v) => v.dnc === false));
  assert.strictEqual(notDnc.json.total, PEOPLE.length + WALKUPS - 3);
  // An address search reaches doors in both campaigns through the household $or.
  const elm = await call('GET', '/admin/voters?search=Elm&limit=200', asAdmin());
  assert.deepStrictEqual(chips(find(elm, 'VD001')), both, 'both campaigns have a 12 Elm St door');
  assert.deepStrictEqual(chips(find(elm, 'VD029')), [B], 'Young lives on Elm St in B only');
});

// ── 2. The short-page guard ─────────────────────────────────────────────────────

test('2. short-page guard: archived campaigns count toward the prefix; orphan rows past it trip the guard and the page stays exact', { skip }, async () => {
  const campaignCount = await Campaign.countDocuments({ organizationId: ctx.org._id });
  assert.strictEqual(campaignCount, 3, 'A, B and the archived, row-less C — every Campaign doc of the org');
  const activeCount = await Campaign.countDocuments({ organizationId: ctx.org._id, isActive: true });
  assert.strictEqual(activeCount, 2);

  // The first three people in directory order (asserted, not assumed) carry the orphan rows.
  const baseline = await oracle({});
  const firstThree = baseline.people.slice(0, 3).map((p) => p.svid);
  assert.deepStrictEqual(firstThree, ['VD001', 'VD002', 'VD003'], 'Abbott, Acker, Adler lead the directory');

  // How many distinct people the first n rows in directory order hold — what a prefix of n index
  // keys can possibly yield. The arithmetic of the guard, done by hand on the real rows.
  const peopleInPrefix = async (n) => {
    const rows = (await Voter.find({ organizationId: ctx.org._id }).lean()).sort(byDirectoryOrder);
    return new Set(rows.slice(0, n).map((r) => r.stateVoterId)).size;
  };
  // A row under a campaignId that has NO Campaign doc — what a half-finished campaign delete
  // leaves behind. Same name and svid as the person's real rows.
  const orphanRowsFor = (campaignId) =>
    Promise.all(
      firstThree.map(async (svid) => {
        const a = await rowIn(ctx.campA, svid);
        return {
          organizationId: ctx.org._id, campaignId, householdId: a.householdId, stateVoterId: svid,
          firstName: a.firstName, lastName: a.lastName, fullName: a.fullName, party: a.party,
        };
      })
    );
  const orphan1 = new mongoose.Types.ObjectId();
  const orphan2 = new mongoose.Types.ObjectId();

  try {
    // Phase 1 — three rows per leading person (A, B, orphan1). Still inside a multiplier of 3,
    // but NOT inside 2: a page of 3 is exact WITHOUT the guard only because the archived campaign
    // counts. Two people could never violate the bound with two orphan campaigns (2 × 4 = 8 rows
    // against any prefix of 3L with L > 2 people needed), which is why three carry them.
    await Voter.insertMany(await orphanRowsFor(orphan1));
    let limit = 3;
    let truth = await oracle({});
    let expected = Math.min(limit, truth.total);
    assert.ok((await peopleInPrefix(limit * campaignCount)) >= expected, 'with C counted, the prefix holds the page');
    assert.ok((await peopleInPrefix(limit * activeCount)) < expected, 'counting only ACTIVE campaigns would starve page one');
    const r1 = await spyWarns(() => call('GET', `/admin/voters?limit=${limit}&skip=0`, asAdmin()));
    assert.deepStrictEqual(r1.warns, [], 'no guard needed: the multiplier counted the archived campaign');
    assertPageMatches(r1.result, truth.people.slice(0, limit), truth.total, 'phase 1 page one');
    const orphanChip = r1.result.json.voters[0].campaigns.find((c) => c.id === String(orphan1));
    assert.ok(orphanChip, 'the orphan row is a chip');
    assert.strictEqual(orphanChip.name, null, 'with no Campaign doc to name it');

    // Phase 2 — four rows per leading person (A, B, orphan1, orphan2): the bound is genuinely
    // violated for page one. 4 × 3 = 12 keys are exactly those three people's rows, so the
    // prefix yields 3 people where the page needs 4 — the guard must fire, then recompute
    // unbounded, and the page must still be exact.
    await Voter.insertMany(await orphanRowsFor(orphan2));
    limit = 4;
    truth = await oracle({});
    expected = Math.min(limit, truth.total);
    const inPrefix = await peopleInPrefix(limit * campaignCount);
    assert.ok(inPrefix < expected, `precondition: ${limit} × ${campaignCount} = ${limit * campaignCount} keys hold ${inPrefix} people; the page needs ${expected}`);
    const r2 = await spyWarns(() => call('GET', `/admin/voters?limit=${limit}&skip=0`, asAdmin()));
    assert.strictEqual(r2.warns.length, 1, 'the guard fired, once');
    assert.match(r2.warns[0], new RegExp(`under-delivered \\(${inPrefix}/${expected}, org ${ctx.org._id}\\); recomputing unbounded`));
    assertPageMatches(r2.result, truth.people.slice(0, limit), truth.total, 'phase 2 page one (recomputed)');
    assert.deepStrictEqual(
      r2.result.json.voters[0].campaigns.map((c) => c.id).sort(),
      [String(ctx.campA._id), String(ctx.campB._id), String(orphan1), String(orphan2)].sort(),
      'all four rows of the leading person are chips'
    );

    // Page two of the same directory: the orphan people are behind the skip, the bound holds
    // again, and the guard stays quiet — it fires only when the page is actually short.
    const skipN = limit;
    const needed = skipN + Math.min(limit, truth.total - skipN);
    assert.ok((await peopleInPrefix((skipN + limit) * campaignCount)) >= needed, 'precondition: page two is inside the bound');
    const r3 = await spyWarns(() => call('GET', `/admin/voters?limit=${limit}&skip=${skipN}`, asAdmin()));
    assert.deepStrictEqual(r3.warns, [], 'no guard on a page the prefix covers');
    assertPageMatches(r3.result, truth.people.slice(skipN, skipN + limit), truth.total, 'phase 2 page two');
  } finally {
    await Voter.deleteMany({ campaignId: { $in: [orphan1, orphan2] } });
  }
  assert.strictEqual((await oracle({})).total, baseline.total, 'fixture restored for the tests after this one');
});

// ── 3 + 4. The budget: expiry maps to a coded 503, and the number reaches both aggregations ──

test('3. timeout mapping: MaxTimeMSExpired → 503 DIRECTORY_TIMEOUT; an unrelated failure stays a 500', { skip }, async () => {
  const expired = Object.assign(new Error('operation exceeded time limit'), { codeName: 'MaxTimeMSExpired', code: 50 });
  const { result: r } = await withAggregateStub(() => Promise.reject(expired), () => call('GET', '/admin/voters', asAdmin()));
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.json.code, 'DIRECTORY_TIMEOUT', 'machine-readable code for the client');
  assert.ok(typeof r.json.error === 'string' && r.json.error.length > 0, 'and a sentence to show');

  // Either half of the expiry check on its own (the driver sets both; a bare code 50 must do).
  const codeOnly = Object.assign(new Error('operation exceeded time limit'), { code: 50 });
  const { result: r2 } = await withAggregateStub(() => Promise.reject(codeOnly), () => call('GET', '/admin/voters', asAdmin()));
  assert.strictEqual(r2.status, 503);
  assert.strictEqual(r2.json.code, 'DIRECTORY_TIMEOUT');

  // Anything else is NOT dressed up as a timeout.
  const { result: r3 } = await withAggregateStub(() => Promise.reject(new Error('boom')), () => call('GET', '/admin/voters', asAdmin()));
  assert.strictEqual(r3.status, 500);
  assert.notStrictEqual(r3.status, 503);
  assert.strictEqual(r3.json.code, undefined, 'no DIRECTORY_TIMEOUT code on an unrelated failure');
  assert.strictEqual(r3.json.error, 'boom');

  // The campaign-nested route shares the mapping (same code, so the client renders the same band)
  // but sends its own sentence: the org one says "pick a campaign", and here one already is. Its
  // plain branch never aggregates, so the expiry is planted on the page's count instead.
  const { result: tab } = await withCountStub(() => Promise.reject(expired), () =>
    call('GET', `/admin/campaigns/${ctx.campA._id}/voters`, asAdmin())
  );
  assert.strictEqual(tab.status, 503);
  assert.strictEqual(tab.json.code, 'DIRECTORY_TIMEOUT');
  assert.ok(typeof tab.json.error === 'string' && tab.json.error.length > 0, 'a sentence to show');
  assert.notStrictEqual(tab.json.error, r.json.error, 'its own sentence, not the org page\'s pick-a-campaign one');
  assert.ok(!/pick a campaign/i.test(tab.json.error), 'never tells a campaign tab to pick a campaign');

  // The stubs are gone: the real directory answers again, on both routes.
  const real = await call('GET', '/admin/voters?limit=1', asAdmin());
  assert.strictEqual(real.status, 200);
  assert.strictEqual(real.json.total, PEOPLE.length + WALKUPS);
  const realTab = await call('GET', `/admin/campaigns/${ctx.campA._id}/voters?limit=1`, asAdmin());
  assert.strictEqual(realTab.status, 200);
  assert.strictEqual(realTab.json.total, await Voter.countDocuments({ organizationId: ctx.org._id, campaignId: ctx.campA._id }));
});

test('4. budget plumbing: VOTER_DIRECTORY_MAX_MS is read per request and handed to BOTH aggregations', { skip }, async () => {
  const hadEnv = Object.prototype.hasOwnProperty.call(process.env, 'VOTER_DIRECTORY_MAX_MS');
  const prevEnv = process.env.VOTER_DIRECTORY_MAX_MS;
  try {
    // Set AFTER the app booted — so a module-load read would still see the default.
    process.env.VOTER_DIRECTORY_MAX_MS = '12345';
    const tuned = await withAggregateStub(() => Promise.resolve([]), () => call('GET', '/admin/voters', asAdmin()));
    assert.strictEqual(tuned.result.status, 200);
    // The budget is ONE deadline per request: each call gets what is left of it, so the two
    // aggregations see the configured value minus the handful of milliseconds already spent.
    const withinBudget = (calls, budget, label) => {
      assert.strictEqual(calls.length, 2, `${label}: page AND count aggregations, both capped`);
      for (const o of calls) {
        assert.strictEqual(typeof o.maxTimeMS, 'number', `${label}: capped as a number`);
        assert.ok(o.maxTimeMS <= budget && o.maxTimeMS > budget - 1000, `${label}: ${o.maxTimeMS} within the ${budget} budget`);
      }
    };
    withinBudget(tuned.optionCalls, 12345, 'tuned');

    // Unset → the 15 s default, same two calls.
    delete process.env.VOTER_DIRECTORY_MAX_MS;
    const dflt = await withAggregateStub(() => Promise.resolve([]), () => call('GET', '/admin/voters', asAdmin()));
    withinBudget(dflt.optionCalls, 15000, 'default');

    // The campaign-scoped branch never aggregates: a plain find, so the stub is never touched.
    const scoped = await withAggregateStub(() => Promise.reject(new Error('must not be called')), () =>
      call('GET', `/admin/voters?campaignId=${ctx.campA._id}&limit=5`, asAdmin())
    );
    assert.strictEqual(scoped.result.status, 200);
    assert.deepStrictEqual(scoped.optionCalls, []);
    assert.strictEqual(scoped.result.json.voters.length, 5);
    // The campaign-nested route is that same plain branch: never an aggregation either.
    const tab = await withAggregateStub(() => Promise.reject(new Error('must not be called')), () =>
      call('GET', `/admin/campaigns/${ctx.campA._id}/voters?limit=5`, asAdmin())
    );
    assert.strictEqual(tab.result.status, 200);
    assert.deepStrictEqual(tab.optionCalls, []);
    assert.deepStrictEqual(tab.result.json, scoped.result.json, 'and it answers the same page');
  } finally {
    if (hadEnv) process.env.VOTER_DIRECTORY_MAX_MS = prevEnv;
    else delete process.env.VOTER_DIRECTORY_MAX_MS;
  }
});

// ── 5 + 6. The indexes: declared in the order the migration diffs on, and actually used ───────

test('5. index signature: both new key patterns are declared exactly as buildIndexes.js will diff them', { skip }, async () => {
  const declared = Voter.schema.indexes(); // [[keys, options], ...]
  const sigs = declared.map(([keys]) => JSON.stringify(keys));
  const covering = JSON.stringify(COVERING_KEYS);
  const campaign = JSON.stringify(CAMPAIGN_KEYS);
  assert.strictEqual(sigs.filter((s) => s === covering).length, 1, `the 9-key covering index, declared once, keys in this order: ${covering}`);
  assert.strictEqual(sigs.filter((s) => s === campaign).length, 1, `the 4-key campaign index, declared once: ${campaign}`);
  // A partial index could not serve the unfiltered pipeline — the covering one must be whole.
  const [, coveringOpts] = declared.find(([keys]) => JSON.stringify(keys) === covering);
  assert.strictEqual(coveringOpts?.partialFilterExpression, undefined, 'the covering index is not partial');
  // And the pre-existing shapes the route still leans on are intact.
  assert.ok(sigs.includes(JSON.stringify({ organizationId: 1, stateVoterId: 1 })), 'the count pipeline\'s DISTINCT_SCAN index');
  assert.ok(sigs.includes(JSON.stringify({ campaignId: 1, stateVoterId: 1 })), 'the per-campaign unique index the prefix bound rests on');
});

test('6. plan pin: the page pipeline rides the covering index — no SORT stage, zero documents examined', { skip }, async () => {
  const skipN = 0;
  const limit = 25;
  const campaignCount = 2;
  const prefix = (skipN + limit) * campaignCount; // 50
  // The exact dedupe page pipeline from services/voters/voterDirectory.js, unfiltered.
  const pipeline = [
    { $match: { organizationId: ctx.planOrgId } },
    { $sort: { lastName: 1, firstName: 1, _id: 1 } },
    { $limit: prefix },
    {
      $group: {
        _id: '$stateVoterId',
        docId: { $first: '$_id' },
        lastName: { $first: '$lastName' },
        firstName: { $first: '$firstName' },
      },
    },
    { $sort: { lastName: 1, firstName: 1, docId: 1 } },
    { $skip: skipN },
    { $limit: limit },
  ];
  assert.strictEqual(await Voter.countDocuments({ organizationId: ctx.planOrgId }), 1000, 'the plan org fixture');
  const explain = await Voter.aggregate(pipeline).allowDiskUse(true).option({ maxTimeMS: 15000 }).explain('executionStats');

  // Walk the whole explain for every planner and executionStats block. mongod 7 puts the cursor
  // stage's plan under stages[0].$cursor; a fully pushed-down pipeline would put queryPlanner at
  // the top level — both shapes are covered. rejectedPlans are skipped: the rejected candidates
  // are exactly the blocking-SORT plans this release retired.
  const planners = [];
  const execs = [];
  const collect = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(collect);
      return;
    }
    if (node.queryPlanner?.winningPlan) planners.push(node.queryPlanner);
    if (node.executionStats && typeof node.executionStats.totalDocsExamined === 'number') execs.push(node.executionStats);
    for (const [k, v] of Object.entries(node)) if (k !== 'rejectedPlans') collect(v);
  };
  collect(explain);
  // Every node that names a stage, anywhere under a plan (classic inputStage chains and SBE's
  // lower-case stage names alike).
  const planNodes = (node, out = []) => {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      node.forEach((n) => planNodes(n, out));
      return out;
    }
    if (typeof node.stage === 'string') out.push(node);
    for (const v of Object.values(node)) planNodes(v, out);
    return out;
  };
  const isSort = (n) => String(n.stage).toUpperCase() === 'SORT';

  assert.ok(planners.length >= 1, 'found the query planner block');
  for (const qp of planners) {
    const nodes = planNodes(qp.winningPlan);
    const names = nodes.map((n) => n.stage);
    assert.ok(nodes.length > 0, 'the winning plan has stages');
    assert.ok(!nodes.some(isSort), `no SORT stage in the winning plan: ${names.join(' → ')}`);
    const ixscans = nodes.filter((n) => n.stage === 'IXSCAN');
    assert.ok(
      ixscans.some((n) => JSON.stringify(n.keyPattern) === JSON.stringify(COVERING_KEYS)),
      `the scan is the covering directory index (got ${ixscans.map((n) => n.indexName).join(', ') || 'no IXSCAN'})`
    );
  }
  assert.ok(execs.length >= 1, 'found executionStats');
  for (const es of execs) {
    assert.strictEqual(es.executionSuccess, true);
    assert.strictEqual(es.totalDocsExamined, 0, 'covered: index keys only, no document fetched');
    assert.ok(es.totalKeysExamined <= prefix, `reads at most the prefix (${es.totalKeysExamined} keys for a prefix of ${prefix})`);
    assert.ok(!planNodes(es.executionStages).some(isSort), 'no sort executed either');
  }
  // The post-group sort over at most `prefix` people stays in memory.
  for (const st of explain.stages || []) {
    if (st.$sort) assert.notStrictEqual(st.usedDisk, true, 'the people sort never spills');
  }

  // And the pipeline's answer at this size is the JS truth: the first 25 people in directory
  // order, each represented by their first-sorted row.
  const out = await Voter.aggregate(pipeline).allowDiskUse(true);
  const rows = (await Voter.find({ organizationId: ctx.planOrgId }).lean()).sort(byDirectoryOrder);
  const seen = new Set();
  const firstPeople = [];
  for (const r of rows) {
    if (seen.has(r.stateVoterId)) continue;
    seen.add(r.stateVoterId);
    firstPeople.push(String(r._id));
    if (firstPeople.length === limit) break;
  }
  assert.deepStrictEqual(out.map((p) => String(p.docId)), firstPeople);
});

// ── 7. The campaign-scoped branch ───────────────────────────────────────────────

test('7. plain branch: ?campaignId is a campaign-scoped find — that campaign\'s rows, no chips, exact total', { skip }, async () => {
  const A = String(ctx.campA._id);
  const r = await call('GET', `/admin/voters?campaignId=${A}&limit=200`, asAdmin());
  assert.strictEqual(r.status, 200);
  const aRows = await Voter.find({ organizationId: ctx.org._id, campaignId: ctx.campA._id }).lean();
  assert.strictEqual(r.json.total, aRows.length, 'total is the COUNT of A rows, not people');
  assert.strictEqual(r.json.voters.length, aRows.length);
  assert.deepStrictEqual(r.json.voters.map((v) => v.id).sort(), aRows.map((a) => String(a._id)).sort(), 'exactly A\'s rows');
  for (const v of r.json.voters) {
    assert.ok(!('campaigns' in v), 'no chips on a campaign-scoped row');
    assert.strictEqual(v.household.campaignId, A, 'housed in A\'s own door');
  }
  for (let i = 1; i < r.json.voters.length; i++) {
    const p = r.json.voters[i - 1];
    const c = r.json.voters[i];
    assert.ok(cmp(p.lastName, c.lastName) || cmp(p.firstName, c.firstName) <= 0, 'name order');
  }
  // A campaign view reads the ROW: A's Abbott is surveyed, B's is not; B's VD017 is 'Smith'.
  assert.strictEqual(r.json.voters.find((v) => v.stateVoterId === 'VD001').surveyStatus, 'surveyed');
  const b = await call('GET', `/admin/voters?campaignId=${ctx.campB._id}&limit=200`, asAdmin());
  assert.strictEqual(b.status, 200);
  assert.strictEqual(b.json.total, await Voter.countDocuments({ organizationId: ctx.org._id, campaignId: ctx.campB._id }));
  assert.strictEqual(b.json.voters.find((v) => v.stateVoterId === 'VD001').surveyStatus, 'not_surveyed');
  assert.strictEqual(b.json.voters.find((v) => v.stateVoterId === 'VD017').lastName, 'Smith');
  assert.strictEqual(b.json.voters.find((v) => v.stateVoterId === 'VD021'), undefined, 'Quinn is A only');
});

// ── 8. Campaign parity ──────────────────────────────────────────────────────────

test('8. campaign parity: GET /admin/campaigns/:id/voters answers exactly what ?campaignId= answers — and both are the campaign\'s own truth — for every filter', { skip }, async () => {
  // One resolver behind both lists (services/voters/voterDirectory.js): the campaign Voters tab
  // (routes/admin/campaignVoters.js, lead-visible) and the org directory narrowed by a validated
  // ?campaignId must never drift apart, page for page. Both are held to the campaign oracle too,
  // so "equal" can never mean "equally wrong".
  for (const campaign of [ctx.campA, ctx.campB]) {
    const cid = String(campaign._id);
    for (const [query] of ORACLE_CASES) {
      const label = `${campaign.name} ${JSON.stringify(query)}`;
      const truth = await campaignOracle(query, campaign);
      for (const skipN of [0, 5, 10]) {
        const qs = new URLSearchParams({ ...query, limit: '5', skip: String(skipN) }).toString();
        const org = await call('GET', `/admin/voters?campaignId=${cid}&${qs}`, asAdmin());
        const tab = await call('GET', `/admin/campaigns/${cid}/voters?${qs}`, asAdmin());
        assert.strictEqual(org.status, 200, `${label} skip ${skipN}: org route`);
        assert.strictEqual(tab.status, 200, `${label} skip ${skipN}: campaign route`);
        assert.deepStrictEqual(tab.json, org.json, `${label} skip ${skipN}: the two routes answer identically (rows, total, limit, skip)`);
        assert.strictEqual(tab.json.total, truth.total, `${label}: total is the campaign's matching-row count`);
        assert.strictEqual(tab.json.voters.length, Math.max(0, Math.min(5, truth.total - skipN)), `${label} skip ${skipN}: page length`);
      }
      const whole = await call('GET', `/admin/campaigns/${cid}/voters?${new URLSearchParams({ ...query, limit: '200' })}`, asAdmin());
      assert.strictEqual(whole.status, 200, `${label}: whole`);
      assert.deepStrictEqual(whole.json.voters.map((v) => v.id).sort(), truth.ids, `${label}: exactly the campaign's matching rows`);
      for (const v of whole.json.voters) {
        assert.ok(!('campaigns' in v), `${label}: no chips on a campaign-scoped row`);
        assert.strictEqual(v.household.campaignId, cid, `${label}: housed in the campaign's own door`);
      }
    }
  }
  // The URL is the scope: a ?campaignId on the campaign route is ignored, not honored.
  const A = String(ctx.campA._id);
  const B = String(ctx.campB._id);
  const stray = await call('GET', `/admin/campaigns/${A}/voters?campaignId=${B}&limit=200`, asAdmin());
  const plain = await call('GET', `/admin/campaigns/${A}/voters?limit=200`, asAdmin());
  assert.deepStrictEqual(stray.json, plain.json, 'A\'s tab with a stray ?campaignId=B is still A');
  const other = await call('GET', `/admin/campaigns/${B}/voters?limit=200`, asAdmin());
  assert.notStrictEqual(stray.json.total, other.json.total, 'and the fixture keeps the two campaigns distinguishable');
});
