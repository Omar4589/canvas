import { test } from 'node:test';
import assert from 'node:assert';
import { EXPORT_TYPE_META, mergeTypeMeta } from './exportTypes.js';

// The server registry's copy laid over the local fallback (GET /admin/exports/types). The export
// sheet names Not a target voter only on a campaign that uses it, so it needs BOTH forms of a
// description from the server: `desc`, which never names the outcome, and `descNotTargetInUse`.
// A merge that dropped the second form would silently show every campaign the plain copy.

const server = [
  { id: 'canvass-activity', label: 'Canvassing activity', desc: 'plain', descNotTargetInUse: 'named', filters: ['date'] },
  { id: 'voter-file', label: 'Voter file', desc: 'voters', descNotTargetInUse: null, filters: ['import'] },
];

test('the server copy wins, and the outcome-naming form rides along', () => {
  const byId = Object.fromEntries(mergeTypeMeta(server).map((m) => [m.id, m]));
  assert.equal(byId['canvass-activity'].desc, 'plain');
  assert.equal(byId['canvass-activity'].descNotTargetInUse, 'named');
  assert.equal(byId['voter-file'].descNotTargetInUse, null, 'a type whose copy never names it');
  assert.equal(byId['canvass-activity'].emoji, EXPORT_TYPE_META[0].emoji, 'mobile-only fields stay local');
});

test('before the server answers, and from an older server, no type has a naming form', () => {
  for (const merged of [mergeTypeMeta(undefined), mergeTypeMeta([{ id: 'canvass-activity', desc: 'old server' }])]) {
    for (const m of merged) assert.ok(!m.descNotTargetInUse, `${m.id}: nothing to show but desc`);
  }
  for (const m of EXPORT_TYPE_META) {
    assert.ok(!/not a target/i.test(m.desc), `${m.id}: the local fallback never names the outcome`);
  }
});
