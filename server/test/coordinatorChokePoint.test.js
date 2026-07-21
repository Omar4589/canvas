import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// STRUCTURAL guard on the crew (coordinator) choke point.
//
// Changing CampaignAssignment.coordinatorId now also RE-STAMPS that person's knock history onto the new
// team (services/memberships/restampCoordinator.js). A new surface that writes the field directly
// would set the roster without moving the doors — and the two would disagree silently, because
// every team number would still add up. No sum-based check can see a value in the wrong bucket,
// which is exactly how the original 104-door bug survived. So the guard has to be structural.
//
// A behavioral test only catches the paths you thought of; this catches the one you didn't.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../src');

// The ONLY files permitted to write CampaignAssignment.coordinatorId — the crew a canvasser
// belongs to IN ONE CAMPAIGN. (It lived on Membership until crews became per-campaign; the guard
// moved with it, because the hazard did.)
const ALLOWED = new Set([
  // The update path. Writes the roster row, then re-stamps this campaign's ledger, then files a
  // CoordinatorChange. Everything that reassigns an existing crew member goes through here.
  'services/memberships/setCoordinator.js',
  // The create path. A lead creating (or linking) a canvasser puts them on this campaign with a
  // crew in one step, and re-stamps any ORPHANED history — org removal hard-deletes the Membership
  // but keeps the knocks, so linking a returning canvasser back in can inherit rows stamped with
  // their old team.
  'routes/admin/leadCrew.js',
  // ── THE SANCTIONED EXCEPTION ───────────────────────────────────────────────────────────────
  // When a coordinator leaves the ORG we clear their crew's coordinatorId — nobody keeps
  // supervising from outside — but we deliberately DO NOT touch the ledger. The stamp on those old
  // knocks is what keeps the departed coordinator's team whole; re-stamping here would dump their
  // crew's entire history into the "No team" bucket admins exclude. That is the original 104-door
  // under-report.
  //
  // So: if this test fails on YOUR file, the question is which of the two you are doing. Changing
  // who someone reports to → route it through setCoordinator.js. Cleaning up after someone leaves
  // → the ledger must stay untouched, and this list needs a deliberate, commented addition.
  'services/users/deleteAccount.js',
  // The backfill that seeded the per-campaign crew from the old org-level one. It writes ONLY the
  // roster, never the ledger — that is what makes it re-runnable and what keeps every existing
  // frozen stamp exactly where it was.
  'migrations/migrateCampaignCoordinators.js',
]);

const WRITE_CALL = /CampaignAssignment\.(updateOne|updateMany|findOneAndUpdate|create|bulkWrite)\b/;

// How many lines after the call opener still count as "the payload". A Membership write is a
// A roster write is a handful of lines; anything further away is a different statement. Mentioning coordinatorId
// somewhere ELSE in a file that also happens to deactivate a member is not a violation — only a
// write whose own payload carries the field is.
const PAYLOAD_WINDOW = 8;

const writesCoordinatorId = (text) => {
  const lines = text.split('\n');
  return lines.some(
    (line, i) =>
      WRITE_CALL.test(line) &&
      lines.slice(i, i + PAYLOAD_WINDOW).join('\n').includes('coordinatorId')
  );
};

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
};

test('only the sanctioned files write CampaignAssignment.coordinatorId', () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    // Read as a Buffer→string: some files under services/person/ carry deliberate NUL bytes and
    // tools that sniff for "binary" skip them silently. An audit that quietly reads nothing is
    // worse than one that fails.
    const text = readFileSync(file, 'latin1');
    if (!writesCoordinatorId(text)) continue;
    if (ALLOWED.has(rel)) continue;
    offenders.push(rel);
  }

  assert.deepEqual(
    offenders,
    [],
    `These files write CampaignAssignment alongside coordinatorId but are not on the choke-point allowlist.\n` +
      `Route crew changes through services/memberships/setCoordinator.js so the knock ledger\n` +
      `is re-stamped with them — or, if this is departure cleanup, add the file to ALLOWED with a\n` +
      `comment saying why the ledger must NOT move.`
  );
});

test('the allowlist itself is honest — every entry still exists and still mentions the field', () => {
  // An allowlist that has rotted stops guarding anything: a renamed file would silently drop off
  // the check while its writes carried on.
  for (const rel of ALLOWED) {
    const full = path.join(SRC, rel);
    const text = readFileSync(full, 'latin1');
    assert.ok(text.includes('coordinatorId'), `${rel} no longer mentions coordinatorId — prune it`);
  }
});
