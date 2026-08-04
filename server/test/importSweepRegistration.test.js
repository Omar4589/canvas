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
