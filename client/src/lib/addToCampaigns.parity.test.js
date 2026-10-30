import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as web from './addToCampaigns.js';
// Cross-tree on purpose (same pattern as rosterView.parity.test.js): the web's Add member and person panel
// and the phone's add sheet and profile must say the same thing about the same add.
import * as mobile from '../../../mobile/lib/addToCampaigns.js';

test('the two copies are the same file', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  assert.equal(read('../../../mobile/lib/addToCampaigns.js'), read('./addToCampaigns.js'));
  assert.deepEqual(Object.keys(mobile).sort(), Object.keys(web).sort());
});

const names = web.coordinatorNames([{ id: 'd1', firstName: 'Dana', lastName: 'Cruz' }]);
const RESULTS = [
  { user: { firstName: 'Jane', lastName: 'Doe' }, outcome: 'created', role: 'canvasser', campaigns: [] },
  { user: { firstName: 'Jane', lastName: 'Doe' }, outcome: 'attached', attached: true, role: 'canvasser', campaigns: [{ campaignName: 'A', result: 'joined', restamp: {} }] },
  {
    user: { firstName: 'Pat' },
    outcome: 'in-org',
    campaigns: [
      { campaignName: 'A', coordinatorId: 'd1', result: 'joined', restamp: { doors: 3, sources: [{ coordinatorId: null, doors: 3 }] } },
      { campaignName: 'B', result: 'already-on', restamp: {} },
      { campaignName: 'C', result: 'error', restamp: {} },
    ],
  },
  { user: { email: 'x@t.co' }, outcome: 'in-org-inactive', campaigns: [] },
];

test('the phone copy answers exactly like the web copy', () => {
  for (const r of RESULTS) {
    assert.deepEqual(mobile.orgDoneView(r, { crewNameById: names }), web.orgDoneView(r, { crewNameById: names }));
    assert.deepEqual(
      mobile.profileDoneView(r.campaigns, { firstName: 'Pat', crewNameById: names }),
      web.profileDoneView(r.campaigns, { firstName: 'Pat', crewNameById: names })
    );
  }
  for (const kind of ['new', 'colleague', 'switched-off', 'profile', 'unknown']) {
    for (const n of [0, 1, 3]) {
      for (const role of ['canvasser', 'lead', 'admin']) assert.equal(mobile.submitLabel(kind, { n, role }), web.submitLabel(kind, { n, role }));
    }
  }
  for (const outcome of ['outside', 'in-org', 'in-org-inactive', 'on-campaign']) {
    assert.equal(mobile.orgConfirmKind({ outcome }), web.orgConfirmKind({ outcome }));
  }
  const picks = { b: 'd1', a: '' };
  assert.deepEqual(mobile.picksBody(picks, ['a', 'b']), web.picksBody(picks, ['a', 'b']));
  assert.deepEqual(mobile.removeQuestion({ name: 'P', campaignName: 'A', crewSize: 2 }), web.removeQuestion({ name: 'P', campaignName: 'A', crewSize: 2 }));
});
