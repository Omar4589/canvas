import { test } from 'node:test';
import assert from 'node:assert';
import { resolveCampaign } from './useCurrentCampaign.js';

// The three states a campaign id can be in, and the one that used to be conflated with the
// others: a cached list that PREDATES the id. The bug this pins is the "Campaign not found"
// flash after creating a campaign — CampaignsPage invalidates ['admin','campaigns'] and
// navigates in the same tick, so the drill-in first renders against a list written before the
// campaign existed, with data present (isLoading false) and a refetch in flight.

const C = (id, name) => ({ _id: id, name });
const LIST = [C('a1', 'Ward 3'), C('a2', 'Ward 4')];

test('a campaign in the list resolves, whatever the query is doing', () => {
  for (const flags of [
    { isLoading: false, isFetching: false },
    { isLoading: false, isFetching: true }, // background poll — must not blank the page
  ]) {
    const r = resolveCampaign({ campaignId: 'a1', campaigns: LIST, ...flags });
    assert.equal(r.campaign.name, 'Ward 3');
    assert.equal(r.resolving, false);
    assert.equal(r.notFound, false);
  }
});

test('THE BUG: an id missing from a STALE list is resolving, not missing', () => {
  // Exactly the create path: data present (so isLoading is false), refetch in flight.
  const r = resolveCampaign({
    campaignId: 'new9',
    campaigns: LIST,
    isLoading: false,
    isFetching: true,
  });
  assert.equal(r.campaign, null);
  assert.equal(r.resolving, true);
  assert.equal(r.notFound, false, 'a list that predates the id has not answered for it');
});

test('an id missing from a SETTLED list is missing — no spinner that never ends', () => {
  const r = resolveCampaign({
    campaignId: 'nope',
    campaigns: LIST,
    isLoading: false,
    isFetching: false,
  });
  assert.equal(r.campaign, null);
  assert.equal(r.resolving, false);
  assert.equal(r.notFound, true);
});

test('a cold list is resolving, not missing', () => {
  const r = resolveCampaign({ campaignId: 'a1', campaigns: [], isLoading: true, isFetching: true });
  assert.equal(r.resolving, true);
  assert.equal(r.notFound, false);
});

test('no id in the URL is an answer in itself — never a spinner', () => {
  // Nothing is being resolved, so even mid-fetch this is the "no campaign selected" branch.
  const r = resolveCampaign({ campaignId: '', campaigns: [], isLoading: true, isFetching: true });
  assert.equal(r.campaign, null);
  assert.equal(r.resolving, false);
  assert.equal(r.notFound, true);
});

test('ids compare as strings — an ObjectId from the router never misses its own row', () => {
  const r = resolveCampaign({
    campaignId: 'a2',
    campaigns: [{ _id: { toString: () => 'a2' }, name: 'Ward 4' }],
    isLoading: false,
    isFetching: false,
  });
  assert.equal(r.campaign.name, 'Ward 4');
});

test('undefined campaigns (query never resolved) does not throw', () => {
  const r = resolveCampaign({ campaignId: 'a1', campaigns: undefined, isLoading: true, isFetching: true });
  assert.equal(r.campaign, null);
  assert.equal(r.resolving, true);
});
