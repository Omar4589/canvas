import { test } from 'node:test';
import assert from 'node:assert';
import { ORG_TABS, ORG_TAB_KEYS, parseOrgPage, orgPagePath } from './orgPageTabs.js';

// The org page's address. Six other surfaces link into it, so a bad tab or month must degrade
// rather than render an empty page or fire a request the server would refuse.

test('every tab has a key and a label', () => {
  for (const t of ORG_TABS) assert.ok(t.key && t.label);
  assert.deepStrictEqual(ORG_TAB_KEYS, ['overview', 'campaigns', 'statements', 'members', 'account']);
});

test('parsing defaults to overview and ignores a malformed month', () => {
  assert.deepStrictEqual(parseOrgPage(new URLSearchParams()), { tab: 'overview', month: null });
  assert.deepStrictEqual(parseOrgPage(new URLSearchParams({ tab: 'statements', month: '2026-08' })), {
    tab: 'statements',
    month: '2026-08',
  });
  assert.deepStrictEqual(
    parseOrgPage(new URLSearchParams({ tab: 'nonsense' })),
    { tab: 'overview', month: null },
    'an unknown tab renders the page, never nothing'
  );
  assert.deepStrictEqual(
    parseOrgPage(new URLSearchParams({ tab: 'statements', month: '2026-13' })),
    { tab: 'statements', month: null },
    'a malformed month is dropped rather than sent to a fetch that would 400'
  );
  assert.deepStrictEqual(parseOrgPage(null), { tab: 'overview', month: null }, 'never throws');
});

test('the path builder omits defaults and empty params', () => {
  assert.strictEqual(orgPagePath('abc'), '/organizations/abc');
  assert.strictEqual(orgPagePath('abc', { tab: 'overview' }), '/organizations/abc', 'the default tab stays out of the URL');
  assert.strictEqual(orgPagePath('abc', { tab: 'statements' }), '/organizations/abc?tab=statements');
  assert.strictEqual(
    orgPagePath('abc', { tab: 'statements', month: '2026-08' }),
    '/organizations/abc?tab=statements&month=2026-08'
  );
  assert.strictEqual(
    orgPagePath('abc', { tab: 'statements', month: 'garbage' }),
    '/organizations/abc?tab=statements',
    'a bad month is never put into a link'
  );
});

test('a path round-trips through the parser', () => {
  const path = orgPagePath('abc', { tab: 'campaigns', month: '2026-08' });
  const parsed = parseOrgPage(new URLSearchParams(path.split('?')[1]));
  assert.deepStrictEqual(parsed, { tab: 'campaigns', month: '2026-08' });
});
