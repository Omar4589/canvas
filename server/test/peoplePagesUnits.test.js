import { test } from 'node:test';
import assert from 'node:assert';
import { mapWithLimit } from '../src/utils/mapWithLimit.js';
import { pacePauseAlert } from '../src/services/mail/templates.js';

// Small pieces of the people-pages build that need no database (docs/PROPOSAL_PEOPLE_PAGES.md).

test('mapWithLimit keeps input order and never runs more than the limit at once', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapWithLimit([5, 1, 4, 2, 3, 0, 6], 3, async (n, i) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, n));
    running -= 1;
    return `${i}:${n}`;
  });
  assert.deepStrictEqual(out, ['0:5', '1:1', '2:4', '3:2', '4:3', '5:0', '6:6']);
  assert.ok(peak <= 3, `peak ${peak}`);
  assert.deepStrictEqual(await mapWithLimit([], 4, async () => 1), []);
});

test('the automatic pause email points at the Settings page, in both versions', () => {
  const m = pacePauseAlert({ orgName: 'Org', campaignName: 'Camp', when: 'today at 3:00 PM', reviewUrl: 'https://doorline.test/pause/x' });
  for (const body of [m.text, m.html]) {
    assert.ok(body.includes('on the Settings page in the web console'), body);
    assert.ok(!body.includes('on the Users page'), 'the old place is gone');
  }
});
