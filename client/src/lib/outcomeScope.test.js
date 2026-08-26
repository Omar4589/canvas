import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScope,
  scopeToSearchParams,
  hasAnswerFilter,
  hasOtherNarrowing,
  scopeIsEmpty,
} from './outcomeScope.js';

test('empty state builds an empty scope, so the query key stays stable', () => {
  assert.deepEqual(buildScope({}), {});
  assert.ok(scopeIsEmpty(buildScope({})));
  assert.equal(scopeToSearchParams(buildScope({})).toString(), '');
});

test('every filter lands under its wire name — dateFrom/dateTo, never from/to', () => {
  const scope = buildScope({
    outcomes: ['refused', 'not_home'],
    userId: 'u1',
    passId: 'p1',
    effortId: 'e1',
    dateRange: { preset: 'custom', from: '2026-08-01', to: '2026-08-03' },
  });
  assert.deepEqual(scope, {
    outcomes: ['refused', 'not_home'],
    userId: 'u1',
    passId: 'p1',
    effortId: 'e1',
    dateFrom: '2026-08-01',
    dateTo: '2026-08-03',
  });
  const sp = scopeToSearchParams(scope);
  assert.equal(sp.get('outcomes'), 'refused,not_home');
  assert.equal(sp.get('dateFrom'), '2026-08-01');
  assert.equal(sp.get('from'), null);
});

test('an open-ended range sends only the bound it has', () => {
  const scope = buildScope({ dateRange: { preset: 'today', from: '2026-08-25', to: null } });
  assert.deepEqual(scope, { dateFrom: '2026-08-25' });
});

test('answer filters ride as JSON, template pinned alongside', () => {
  const answerFilters = [{ questionKey: 'support', values: ['yes'], texts: [] }];
  const scope = buildScope({ userId: 'u1', surveyTemplateId: 't1', answerFilters });
  assert.deepEqual(scope.answerFilters, answerFilters);
  assert.equal(scope.surveyTemplateId, 't1');
  const sp = scopeToSearchParams(scope);
  assert.deepEqual(JSON.parse(sp.get('answerFilters')), answerFilters);
});

test('surveyTemplateId is carried only WITH an answer filter — alone it is not a filter', () => {
  assert.deepEqual(buildScope({ surveyTemplateId: 't1' }), {});
});

test('the gate predicates mirror the server: chips and answers do not count as narrowing', () => {
  assert.equal(hasOtherNarrowing(buildScope({ outcomes: ['refused'] })), false);
  assert.equal(
    hasOtherNarrowing(buildScope({ surveyTemplateId: 't1', answerFilters: [{ questionKey: 'q', values: ['a'] }] })),
    false
  );
  assert.equal(hasOtherNarrowing(buildScope({ userId: 'u1' })), true);
  assert.equal(hasOtherNarrowing(buildScope({ dateRange: { from: '2026-08-01', to: null } })), true);
  assert.equal(hasOtherNarrowing(buildScope({ effortId: 'e1' })), true);

  assert.equal(hasAnswerFilter(buildScope({ userId: 'u1' })), false);
  assert.equal(
    hasAnswerFilter(buildScope({ surveyTemplateId: 't1', answerTagFilters: [{ tag: 'Supporter' }] })),
    true
  );
});
