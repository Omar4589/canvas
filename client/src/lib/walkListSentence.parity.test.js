import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { walkListSentence as web } from './campaignHistory.js';

// Cross-tree on purpose (the byPassFold.parity.test.js pattern): a walk-list or pass archive row must
// read the same sentence in the web History drawer and on the phone's History screen.
// The phone's campaignHistory.js imports './goalPace' and './theme' with no extension, which Metro
// resolves and node's ESM loader refuses — the same retry-with-'.js' hook as
// mobile/lib/campaignHistory.test.js, registered before the dynamic import.
const RESOLVE_JS = `export const resolve = async (specifier, context, next) => {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') || specifier.endsWith('.js')) throw err;
    return next(specifier + '.js', context);
  }
};`;
register(`data:text/javascript,${encodeURIComponent(RESOLVE_JS)}`);
const { walkListSentence: mobile } = await import('../../../mobile/lib/campaignHistory.js');

const PEOPLE = [
  { id: 'u1', name: 'Ada', status: 'active' },
  { id: 'u2', name: 'Lee Lead', status: 'deactivated' },
  { id: null, name: 'One-time check' },
  null,
];
const ROWS = [
  ['walkListArchived', 'ended'],
  ['walkListArchived', 'nothing-live'],
  ['walkListUnarchived', 'brought-back'],
  ['walkListUnarchived', 'stayed-ended'],
  ['walkListUnarchived', 'nothing-ended'],
  ['passArchived', 'by-hand'],
  ['passArchived', 'repair'],
  ['passBroughtBack', 'live'],
  ['passBroughtBack', 'draft'],
  ['passBroughtBack', 'a-future-outcome'],
  ['doorGoal', 'ended'],
];
const DETAILS = [
  { walkList: 'North', pass: 'Pass 3 · GOTV' },
  { walkList: 'North — Pass 9', pass: 'Pass 2' },
  { walkList: null, pass: 'Pass 3' },
  { walkList: 'North', pass: null },
];

test('the web and the phone build the same walk-list History sentence for every row', () => {
  for (const [field, outcome] of ROWS) {
    for (const facts of DETAILS) {
      for (const by of PEOPLE) {
        const item = { kind: 'config', field, by, fromValue: 'x', toValue: 'y', details: { ...facts, outcome } };
        assert.equal(mobile(item), web(item), `${field} ${outcome} ${JSON.stringify(facts)} ${by?.name}`);
      }
    }
  }
  assert.equal(mobile({ kind: 'config', field: 'passArchived' }), web({ kind: 'config', field: 'passArchived' }));
});
