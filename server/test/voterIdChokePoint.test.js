import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// STRUCTURAL guard on how voter IDs from OUTSIDE the database are looked up.
//
// A stored stateVoterId has whatever spelling the file that created it used (Georgia 08719967,
// Excel's 8719967, Nebraska's unpadded 1234567). An ID that arrives from outside — an uploaded
// list, a typed ID, a parked ID — may be spelled the other way, so it must go through
// services/voters/voterIdLookup.js, which searches every spelling at once. A new upload feature that
// writes `stateVoterId: { $in: ids }` compiles, passes every test that seeds one spelling, and
// silently matches nobody in production the day a list goes through Excel. No behavioral test
// catches the surface you did not think of; this one does.
//
// Comparing a STORED ID exactly (a sibling row of a voter you already hold, a Person key, the
// importer's own upsert) is fine and stays exact — those files are listed below with the reason.
// If this test fails on YOUR file, the question is which kind of ID you are holding.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../src');

// Files allowed to query stateVoterId directly, and why. This list is also the post-election
// worklist: every entry marked "stored, exact by design" is correct only while the audit
// (npm run audit:voter-id-spellings) finds no person stored under two spellings.
const ALLOWED = new Map([
  // THE choke point. Canonical ID → every spelling → one $in on the existing indexes.
  ['services/voters/voterIdLookup.js', 'the helper itself'],
  // The importer's write path stays exact until the post-election adoption/stored-key work: its
  // upsert filter, in-file dedupe, hand-edit shield and DNC-seed prefetches all key on the file's
  // spelling (docs/PROPOSAL_VOTER_ID_KEYS.md). The worker refuses a zero-only-matching re-import
  // before this runs, so the exactness cannot double a campaign.
  ['services/import/csvImporter.js', 'importer write path — deferred (proposal §C/§D)'],
  // The preview's new-vs-updated forecast: an exact pass, then the zero-only pass through the helper.
  ['services/import/computeImportDiff.js', 'exact pass feeds zeroOnlyMatchesForMisses'],
  // Re-housing audit before/after the write, on the file's own IDs (stored after apply).
  ['services/import/importProcessor.js', 're-housing audit on the rows about to be written'],
  // Do-not-contact's sticky graduation is deliberately still exact: org-wide, and two states can
  // issue the same digits. DncPendingId.state is recorded so the post-election version can scope it.
  ['services/dnc/reapplyDncLists.js', 'sticky DNC graduation — exact by choice (org-wide; honors the declared state)'],
  // Sibling rows of a voter the admin is already looking at: a stored ID compared to stored IDs.
  ['routes/admin/voters.js', 'stored-ID sibling propagation of the do-not-contact flag'],
  ['services/voters/voterDirectory.js', 'stored-ID sibling rows of the page (the org view\'s campaign chips + surveyed-in-any)'],
  ['services/voters/voterProfile.js', 'stored-ID sibling rows on the profile'],
  ['services/campaigns/deleteCampaign.js', 'stored-ID survivor check and parking on campaign delete'],
  // The Person layer keys on (registeredState, stateVoterId) exactly, by its own design (PERSONS.md).
  ['services/person/resolvePerson.js', 'Person svidKeys are exact by design'],
  ['services/person/mergePersons.js', 'Person svidKeys are exact by design'],
  // Counters group on the raw string (correct while the audit is clean; on the post-election list).
  ['services/platform/platformStats.js', 'people counters group on the stored string'],
  // Read-only audits and one-time migrations: they measure or repair stored spellings themselves.
  ['migrations/auditVoterIdSpellings.js', 'the audit measures stored spellings'],
  ['migrations/migrateVoterCampaigns.js', 'one-time migration'],
]);

// KNOWN LIMIT: the detector sees a filter LITERAL within WINDOW lines of the call. A filter built
// into a variable first and passed later (the two directory search boxes, services/voters/voterDirectory.js
// and routes/mobile/voters.js, which take a TYPED id and compare it exactly) is not seen. Those are
// on the post-election worklist in docs/PROPOSAL_VOTER_ID_KEYS.md; a `$group` on '$stateVoterId'
// is deliberately not a hit (a count is not a lookup).

// A query call on a voter-bearing model (or the generic `Model`/`findInChunks` helpers) whose
// argument window mentions stateVoterId as a FILTER key — not a projection (`stateVoterId: 1`),
// not a `$stateVoterId` group expression, not a write payload.
const QUERY_CALL = /\b(?:Voter|VotedVoter|VotedPendingId|DncPendingId|Person|Model|M)\.(?:find|findOne|findOneAndUpdate|countDocuments|exists|distinct|deleteMany|deleteOne|updateOne|updateMany|aggregate)\s*\(|\bfindInChunks\s*\(/;
// `stateVoterId:` followed by anything but a bare `1` (a projection); or the field name passed as a
// string argument (findInChunks, computed keys).
const FILTER_KEY = /(?:^|[{,\s])stateVoterId\s*:(?!\s*1\s*[,}\n])|\[\s*'stateVoterId'\s*\]|,\s*'stateVoterId'\s*,/;
const WINDOW = 10;

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js') && !p.endsWith('.test.js')) out.push(p);
  }
  return out;
};

// readFileSync is NUL-safe: three files under services/person and services/dnc carry NUL bytes
// that make plain `grep` skip them silently (repo CLAUDE.md), which is exactly how an audit once
// concluded a subsystem did not exist.
const queriesStateVoterId = (text) => {
  const lines = text.split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    if (!QUERY_CALL.test(line)) return;
    const window = lines.slice(i, i + WINDOW).join('\n');
    if (FILTER_KEY.test(window)) hits.push(i + 1);
  });
  return hits;
};

test('every exact-string voter-ID query outside the helper is on the allowlist with a reason', () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file);
    const hits = queriesStateVoterId(readFileSync(file, 'utf8'));
    if (!hits.length) continue;
    if (!ALLOWED.has(rel)) offenders.push(`${rel}:${hits.join(',')}`);
  }
  assert.deepStrictEqual(
    offenders,
    [],
    'A file queries stateVoterId directly. If the ID came from outside the database (an upload, a typed\n' +
      'value, a parked ID), route it through services/voters/voterIdLookup.js. If it is a STORED ID being\n' +
      'compared to stored IDs, add the file to ALLOWED in test/voterIdChokePoint.test.js with the reason:\n  ' +
      offenders.join('\n  ')
  );
});

test('the allowlist carries no stale entries', () => {
  const present = new Set(walk(SRC).map((f) => path.relative(SRC, f)));
  const stale = [...ALLOWED.keys()].filter((rel) => !present.has(rel));
  assert.deepStrictEqual(stale, [], `allowlisted files that no longer exist: ${stale.join(', ')}`);
  const idle = [...ALLOWED.keys()].filter((rel) => present.has(rel) && !queriesStateVoterId(readFileSync(path.join(SRC, rel), 'utf8')).length);
  assert.deepStrictEqual(idle, [], `allowlisted files that no longer query stateVoterId (remove them): ${idle.join(', ')}`);
});
