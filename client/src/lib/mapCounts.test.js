import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtCount, pluralize, universeLabel, describeMatch, inViewClip, headerCounts, explainCounts, MAP_HOUSEHOLD_CAP,
} from './mapCounts.js';

const counts = (m, u, extra = {}) => ({
  matching: { total: m, excludedFromTurf: 0, doNotKnock: 0, ...(extra.matching || {}) },
  universe: { total: u, excludedFromTurf: 0, doNotKnock: 0, ...(extra.universe || {}) },
  byStatus: {},
});

test('fmtCount / pluralize / universeLabel', () => {
  assert.equal(fmtCount(3513), (3513).toLocaleString());
  assert.equal(fmtCount(0), '0');
  assert.equal(fmtCount(null), '—');
  assert.equal(fmtCount(undefined), '—');
  assert.equal(fmtCount('abc'), '—');
  assert.equal(pluralize(1, 'door'), 'door');
  assert.equal(pluralize(0, 'door'), 'doors');
  assert.equal(pluralize(2, 'building'), 'buildings');
  assert.equal(pluralize(1, 'door matches', 'doors match'), 'door matches');
  assert.equal(universeLabel(''), 'in campaign');
  assert.equal(universeLabel(null), 'in campaign');
  assert.equal(universeLabel('North'), 'in North');
});

test('describeMatch: all time with nothing narrowing → "every door"', () => {
  assert.equal(describeMatch({ preset: 'all' }), 'every door');
  assert.equal(describeMatch({}), 'every door');
  assert.equal(describeMatch({ preset: 'all', statusLabels: ['Surveyed'] }), 'every door with status Surveyed');
});

test('describeMatch: each preset names the window the server narrows to', () => {
  assert.equal(describeMatch({ preset: 'today' }), 'doors with a knock or survey today');
  assert.equal(describeMatch({ preset: 'yesterday' }), 'doors with a knock or survey yesterday');
  assert.equal(describeMatch({ preset: '7d' }), 'doors with a knock or survey in the last 7 days');
  assert.equal(describeMatch({ preset: '30d' }), 'doors with a knock or survey in the last 30 days');
});

test('describeMatch: custom ranges read as dates; single day, open start, open end', () => {
  const between = describeMatch({ preset: 'custom', from: '2026-06-10', to: '2026-06-14' });
  assert.match(between, /^doors with a knock or survey between .* and .*$/);
  const sameDay = describeMatch({ preset: 'custom', from: '2026-06-10', to: '2026-06-10' });
  assert.match(sameDay, /^doors with a knock or survey on /);
  assert.match(describeMatch({ preset: 'custom', from: '2026-06-10', to: null }), /^doors with a knock or survey since /);
  assert.match(describeMatch({ preset: 'custom', from: null, to: '2026-06-10' }), /^doors with a knock or survey up to /);
});

test('describeMatch: canvasser, statuses, answer and scope append in a fixed order', () => {
  assert.equal(
    describeMatch({ preset: 'today', canvasserName: 'Jane Doe' }),
    'doors with a knock or survey today by Jane Doe'
  );
  // All time + a canvasser still narrows to that canvasser's interactions (never "every door").
  assert.equal(describeMatch({ preset: 'all', canvasserName: 'Jane Doe' }), 'doors with a knock or survey by Jane Doe');
  // An answer filter narrows to SURVEYS, so it says so.
  assert.equal(describeMatch({ preset: 'all', answerOption: 'Yes' }), 'doors surveyed with the answer "Yes"');
  assert.equal(
    describeMatch({ preset: 'today', statusLabels: ['Surveyed', 'Refused'] }),
    'doors with a knock or survey today with status Surveyed or Refused'
  );
  assert.equal(
    describeMatch({ preset: 'today', statusLabels: ['Surveyed', 'Refused', 'Not home'] }),
    'doors with a knock or survey today with status Surveyed, Refused or Not home'
  );
  assert.equal(
    describeMatch({
      preset: '7d', canvasserName: 'Jane Doe', statusLabels: ['Surveyed'], answerOption: 'Yes', scopeLabel: 'Pass 2 · GOTV',
    }),
    'doors surveyed in the last 7 days by Jane Doe with the answer "Yes" with status Surveyed, Pass 2 · GOTV'
  );
});

test('inViewClip: null when the drawn set is the whole matching set', () => {
  assert.equal(inViewClip({ matchingTotal: 100, shownCount: 100, payloadCount: 100, excludedVis: 'show', truncated: false }), null);
  // A transiently LARGER payload (live poll mid-flight) is not a clip either.
  assert.equal(inViewClip({ matchingTotal: 99, shownCount: 100, payloadCount: 100, excludedVis: 'show', truncated: false }), null);
  assert.equal(inViewClip({ matchingTotal: null, shownCount: 5, payloadCount: 5 }), null);
  assert.equal(inViewClip({ matchingTotal: 5, shownCount: null, payloadCount: 5 }), null);
});

test('inViewClip: viewport, hide, cap — and the cap takes precedence over the viewport reason', () => {
  assert.deepEqual(
    inViewClip({ matchingTotal: 3513, shownCount: 1200, payloadCount: 1200, excludedVis: 'show', truncated: false }),
    { shown: 1200, byViewport: true, byHide: false, byCap: false }
  );
  // Hide: the payload holds everything, Hide removed 483 from the drawn set.
  assert.deepEqual(
    inViewClip({ matchingTotal: 3513, shownCount: 3030, payloadCount: 3513, excludedVis: 'hide', truncated: false }),
    { shown: 3030, byViewport: false, byHide: true, byCap: false }
  );
  // Dim never changes the drawn set, so it is never a reason.
  assert.equal(inViewClip({ matchingTotal: 3513, shownCount: 3513, payloadCount: 3513, excludedVis: 'dim', truncated: false }), null);
  assert.deepEqual(
    inViewClip({ matchingTotal: 80000, shownCount: 50000, payloadCount: 50000, excludedVis: 'show', truncated: true }),
    { shown: 50000, byViewport: false, byHide: false, byCap: true }
  );
  // Both hide and viewport at once.
  assert.deepEqual(
    inViewClip({ matchingTotal: 3513, shownCount: 1000, payloadCount: 1200, excludedVis: 'hide', truncated: false }),
    { shown: 1000, byViewport: true, byHide: true, byCap: false }
  );
});

test('headerCounts: loading, then "in view" until the totals exist', () => {
  assert.deepEqual(headerCounts({ loading: true, counts: null, shownCount: 0, payloadCount: 0 }), {
    primary: { n: null, label: 'Loading households…' }, secondary: null, inView: null, emptyHint: null,
  });
  const h = headerCounts({ loading: false, counts: null, shownCount: 2104, payloadCount: 2104 });
  assert.deepEqual(h.primary, { n: 2104, label: 'doors in view' });
  assert.equal(h.secondary, null);
  assert.deepEqual(headerCounts({ loading: false, counts: null, shownCount: 1, payloadCount: 1 }).primary, { n: 1, label: 'door in view' });
});

test('headerCounts: matching == universe collapses to "N doors in campaign" (or the walk list)', () => {
  const h = headerCounts({ loading: false, counts: counts(10482, 10482), shownCount: 10482, payloadCount: 10482, excludedVis: 'show' });
  assert.deepEqual(h.primary, { n: 10482, label: 'doors in campaign' });
  assert.equal(h.secondary, null);
  assert.equal(h.inView, null);
  const e = headerCounts({ loading: false, counts: counts(4200, 4200), shownCount: 4200, payloadCount: 4200, effortName: 'North' });
  assert.equal(e.primary.label, 'doors in North');
});

test('headerCounts: the match/of line, singular, in-view pill and empty hints', () => {
  const h = headerCounts({ loading: false, counts: counts(3513, 10482), shownCount: 1200, payloadCount: 1200, excludedVis: 'show' });
  assert.deepEqual(h.primary, { n: 3513, label: 'doors match' });
  assert.equal(h.secondary, `of ${(10482).toLocaleString()} in campaign`);
  assert.equal(h.inView, `${(1200).toLocaleString()} in view`);
  assert.equal(h.emptyHint, null);
  assert.equal(headerCounts({ loading: false, counts: counts(1, 10), shownCount: 1, payloadCount: 1 }).primary.label, 'door matches');
  // Placeholder data (a filter just changed): no in-view claim, numbers still shown.
  const p = headerCounts({ loading: false, counts: counts(3513, 10482), shownCount: 1200, payloadCount: 1200, placeholder: true });
  assert.equal(p.inView, null);
  assert.equal(p.primary.n, 3513);
  // Empty on Today vs empty on All time read differently.
  assert.equal(
    headerCounts({ loading: false, counts: counts(0, 10482), shownCount: 0, payloadCount: 0, isAllTime: false }).emptyHint,
    'none touched in this date range yet — pick All time for every door'
  );
  assert.equal(
    headerCounts({ loading: false, counts: counts(0, 10482), shownCount: 0, payloadCount: 0, isAllTime: true }).emptyHint,
    'no doors match these filters'
  );
});

test('explainCounts: rows in order, zero sub-counts read as "none", matching extras only when present', () => {
  const c = counts(3513, 10482, { universe: { excludedFromTurf: 483, doNotKnock: 12 }, matching: { excludedFromTurf: 483, doNotKnock: 4 } });
  const clip = { shown: 1200, byViewport: true, byHide: true, byCap: false };
  const rows = explainCounts({ counts: c, clip, facts: { preset: 'today' }, effortName: '' });
  assert.equal(rows.length, 4);
  assert.match(rows[0], /^3,513 doors match: doors with a knock or survey today\. Counted across the whole campaign/);
  assert.match(rows[1], /^1,200 in view — the map only loads the area on screen.*; you have hidden the doors excluded from books/);
  assert.match(rows[2], /^10,482 doors in campaign — every active door with a map pin, regardless of filters, including 483 excluded from books and 12 do-not-knock\.$/);
  assert.match(rows[3], /^Of the matching doors, 483 excluded from books and 4 do-not-knock — Show \/ Dim \/ Hide/);

  const plain = explainCounts({ counts: counts(10, 10), clip: null, facts: { preset: 'all' }, effortName: 'North' });
  assert.equal(plain.length, 2, 'no in-view row, no matching-extras row');
  assert.match(plain[0], /^10 doors match: every door\./);
  assert.match(plain[1], /^10 doors in North — .* including none excluded from books and none do-not-knock\.$/);

  const capped = explainCounts({ counts: counts(80000, 80000), clip: { shown: 50000, byViewport: false, byHide: false, byCap: true }, facts: {}, effortName: '' });
  assert.match(capped[1], new RegExp(`^50,000 in view — the map draws at most ${MAP_HOUSEHOLD_CAP.toLocaleString()} doors per pull`));
});
