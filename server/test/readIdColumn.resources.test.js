// What the Excel reader costs the shared web dyno (docs/PROPOSAL_ID_LIST_EXCEL.md §B.2, §D) — no DB.
// Each measurement runs in its own child process (test/support/readIdColumnResources.child.js), so the
// peak memory is the reader's and not this suite's. Synthetic rows only; the files live in the OS temp
// dir for the length of the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const CHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'support', 'readIdColumnResources.child.js');
const run = (...args) => execFileSync(process.execPath, [CHILD, ...args], { encoding: 'utf8', maxBuffer: 1 << 20 });

const withFile = (fn) => {
  const file = path.join(os.tmpdir(), `id-list-resources-${crypto.randomUUID()}.xlsx`);
  try {
    return fn(file);
  } finally {
    fs.rmSync(file, { force: true });
  }
};

test('a 1,048,575-row list of shared-string IDs reads under the 320 MB budget', { timeout: 180000 }, () => {
  withFile((file) => {
    run('build-long', file);
    const r = JSON.parse(run('read', file));
    assert.equal(r.rows, 1048575);
    assert.equal(r.first, '1000000');
    assert.ok(r.maxRssMb < 320, `peak ${r.maxRssMb} MB`);
  });
});

test('a stored (uncompressed) sheet under the 50 MB cap never blocks the event loop for long, and fits the budget', { timeout: 180000 }, () => {
  withFile((file) => {
    run('build-stored', file);
    const size = fs.statSync(file).size;
    assert.ok(size < 50 * 1024 * 1024, `the file is under the upload cap (${size} bytes)`);
    const r = JSON.parse(run('read', file));
    assert.equal(r.rows, 450000);
    assert.ok(r.maxPauseMs < 100, `longest pause ${r.maxPauseMs} ms`);
    // A stored sheet costs more than a deflated one of the same rows (measured ~346 MB for this 47 MB
    // file, against ~150 MB for the deflated million-row list above): its whole part arrives as one
    // chunk, once per pass. Bounded here so a change that made it worse is caught.
    assert.ok(r.maxRssMb < 400, `peak ${r.maxRssMb} MB`);
  });
});

test('long TEXT IDs keep no chunk of the file alive: 150,000 twenty-character IDs stay under budget', { timeout: 180000 }, () => {
  withFile((file) => {
    run('build-text', file);
    const r = JSON.parse(run('read', file));
    assert.equal(r.rows, 150000);
    assert.equal(r.first.length, 20);
    // ~120 MB with each kept ID copied (readIdColumn.js own()); ~313 MB when kept IDs were slices that
    // held their decoded chunks (measured on a copy without own()), so this bound tells them apart.
    assert.ok(r.maxRssMb < 200, `peak ${r.maxRssMb} MB`);
  });
});

test('rows 1-10 keep no chunk of the file alive either: 9,000 column names spread through row 1', { timeout: 180000 }, () => {
  withFile((file) => {
    run('build-wide', file);
    const r = JSON.parse(run('read', file));
    assert.equal(r.rows, 1000);
    assert.equal(r.first, '1000002');
    // ~112 MB with rows 1-10 copied (readIdColumn.js own()); ~254 MB when those cells were slices that
    // held their inflated chunks (measured on a copy without own()), so this bound tells them apart.
    assert.ok(r.maxRssMb < 180, `peak ${r.maxRssMb} MB`);
  });
});
