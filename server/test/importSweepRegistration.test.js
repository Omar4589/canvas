// Pure registration guards — no DB, always run.
//
// The stale-import sweep must be scheduled (or stuck jobs + orphaned raw uploads
// come back), and it must NEVER sit in REPEATABLE_JOBS: that list is the
// retention-promise health surface (/health/retention reports on every entry and
// supportAccess.int.test.js pins its count) — an import sweep going quiet must
// not read as "Retention: NOT ENFORCED".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAINTENANCE_JOBS, REPEATABLE_JOBS } from '../src/services/retention/scheduler.js';
import { IMPORT_SWEEP_JOB } from '../src/services/import/sweepStaleImports.js';
import { FBTIME_RECENT_JOB, FBTIME_DEEP_JOB } from '../src/services/fbtime/sync.js';

test('stale-import sweep is registered as maintenance, never as retention', () => {
  assert.ok(
    MAINTENANCE_JOBS.some((j) => j.name === IMPORT_SWEEP_JOB),
    'IMPORT_SWEEP_JOB must be in MAINTENANCE_JOBS'
  );
  assert.ok(
    !REPEATABLE_JOBS.some((j) => j.name === IMPORT_SWEEP_JOB),
    'IMPORT_SWEEP_JOB must never be in the pinned retention list'
  );
});

test('every maintenance job has a cron and a label for the health surface', () => {
  for (const j of MAINTENANCE_JOBS) {
    assert.ok(j.name && j.cron && j.label, `${j.name || '(unnamed)'} is missing name/cron/label`);
  }
});

// Same shape for the FbTime hours sync: both jobs scheduled, neither on the
// retention health banner — measured hours going quiet degrades to estimated
// hours with a label, not to a broken legal promise.
test('both FbTime sync jobs are registered as maintenance, never as retention', () => {
  for (const name of [FBTIME_RECENT_JOB, FBTIME_DEEP_JOB]) {
    assert.ok(MAINTENANCE_JOBS.some((j) => j.name === name), `${name} must be in MAINTENANCE_JOBS`);
    assert.ok(!REPEATABLE_JOBS.some((j) => j.name === name), `${name} must never be in the pinned retention list`);
  }
});
