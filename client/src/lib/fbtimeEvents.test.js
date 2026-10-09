import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventText } from './fbtimeEvents.js';

// Recent activity says who and why. The names come from the server (`by`, `subject`,
// resolved at read time); the sentences are pinned here, including the one rule that
// must never break: no email, ever.

const ADA = { name: 'Ada Admin', status: 'active' };
const ev = (type, detail = null, over = {}) => ({ id: type, type, detail, by: ADA, subject: null, at: '2026-10-09T15:00:00Z', ...over });

test('door counts turned on and off — who, and why', () => {
  assert.equal(eventText(ev('doors-enabled')), 'Door counts turned on — by Ada Admin');
  assert.equal(
    eventText(ev('doors-enabled', { clearCancelled: true })),
    'Door counts turned on — by Ada Admin (the waiting clear was cancelled)'
  );
  assert.equal(eventText(ev('doors-disabled', { reason: 'admin', clear: true })), 'Door counts turned off — by Ada Admin (cleared)');
  assert.equal(eventText(ev('doors-disabled', { reason: 'admin', clear: false })), 'Door counts turned off — by Ada Admin');
  assert.equal(eventText(ev('doors-disabled', { reason: 'disconnected' })), 'Door counts turned off — disconnected');
  assert.equal(eventText(ev('doors-disabled', { reason: 'org-changed' })), 'Door counts turned off — FbTime organization changed');
});

test('the worker’s events say they happened automatically', () => {
  const auto = { by: null };
  assert.equal(eventText(ev('doors-failed', { code: 'VALIDATION' }, auto)), 'Door counts started failing (VALIDATION) — automatic');
  assert.equal(
    eventText(ev('doors-failed', { code: 'INVALID_TIMEZONE', campaign: 'Ward 5' }, auto)),
    'Door counts started failing (INVALID_TIMEZONE) in campaign Ward 5 — automatic'
  );
  assert.equal(
    eventText(ev('doors-failed', { code: 'VALIDATION', phase: 'clear' }, auto)),
    'Door counts started failing (VALIDATION) while clearing — automatic'
  );
  assert.equal(eventText(ev('doors-recovered', { code: 'VALIDATION' }, auto)), 'Door counts recovered — automatic');
  assert.equal(eventText(ev('doors-cleared', { count: 3 }, auto)), 'Cleared door counts for 3 people — automatic');
  assert.equal(eventText(ev('doors-cleared', { count: 1 }, auto)), 'Cleared door counts for 1 person — automatic');
  assert.equal(eventText(ev('sync-failed', { code: 'KEY_REVOKED' }, auto)), 'Sync started failing (KEY_REVOKED) — automatic');
  assert.equal(
    eventText(ev('link-removed', { reason: 'identity-purge', count: 2 }, auto)),
    'Links removed when a deleted account’s details were erased (2) — automatic'
  );
  // A person whose name is gone is still a person: no name, and never "automatic".
  assert.equal(eventText(ev('doors-enabled', null, { by: { name: null, status: 'deleted' } })), 'Door counts turned on');
});

test('clears asked for and abandoned', () => {
  assert.equal(eventText(ev('doors-clears-abandoned', { count: 2, all: false })), 'Waiting clears abandoned (2) — by Ada Admin');
  assert.equal(eventText(ev('doors-clears-abandoned', { count: 0, all: true })), 'Waiting clears abandoned (everyone) — by Ada Admin');
  assert.equal(eventText(ev('doors-clears-abandoned', { count: 2, all: true })), 'Waiting clears abandoned (everyone + 2) — by Ada Admin');
  assert.equal(eventText(ev('doors-clear-requested', { all: true })), 'Asked to clear door counts for everyone — by Ada Admin');
  // A door-count event never stores a user id beside a person id, so the page names
  // the FbTime person off its own roster.
  const names = new Map([['aa00000000000000000000a1', 'Maria D.']]);
  assert.equal(
    eventText(ev('doors-clear-requested', { fbtimePersonId: 'aa00000000000000000000a1' }), { personName: (id) => names.get(id) }),
    'Asked to clear door counts for Maria D. — by Ada Admin'
  );
  assert.equal(
    eventText(ev('doors-clear-requested', { fbtimePersonId: 'ff' })),
    'Asked to clear door counts for an FbTime person — by Ada Admin'
  );
});

test('link and kept-account events name whom they are about', () => {
  const maria = { subject: { name: 'Maria Ortega', status: 'deleted' } };
  assert.equal(eventText(ev('link-created', { userId: 'u1' }, maria)), 'Canvasser linked: Maria Ortega — by Ada Admin');
  assert.equal(
    eventText(ev('link-created', { userId: 'u1', clearCancelled: true }, maria)),
    'Canvasser linked: Maria Ortega — by Ada Admin (the waiting clear was cancelled)'
  );
  assert.equal(eventText(ev('link-removed', { userId: 'u1', doors: 'keep' }, maria)), 'Canvasser unlinked: Maria Ortega — by Ada Admin (kept as an earlier account)');
  assert.equal(
    eventText(ev('link-removed', { userId: 'u1', doors: 'clear', clear: true }, maria)),
    'Canvasser unlinked: Maria Ortega — by Ada Admin (the link was wrong — clearing door counts)'
  );
  assert.equal(eventText(ev('link-removed', { userId: 'u1' }, maria)), 'Canvasser unlinked: Maria Ortega — by Ada Admin');
  assert.equal(eventText(ev('account-kept', { userId: 'u1' }, maria)), 'Kept an earlier account for Maria Ortega — by Ada Admin');
  assert.equal(eventText(ev('account-kept-removed', { userId: 'u1' }, maria)), 'Stopped counting an earlier account (Maria Ortega) — by Ada Admin');
  assert.equal(eventText(ev('account-kept-removed', { userId: 'u1' })), 'Stopped counting an earlier account — by Ada Admin');
});

test('the older events keep their words, now with who', () => {
  assert.equal(eventText(ev('connected')), 'Connected — by Ada Admin');
  assert.equal(eventText(ev('key-rotated')), 'API key replaced — by Ada Admin');
  assert.equal(eventText(ev('figure-changed', { from: 'grossHours', to: 'adjustedHours' })), 'Hours figure changed → Adjusted hours — by Ada Admin');
  assert.equal(eventText(ev('auto-matched', { count: 4 })), 'Auto-matched 4 by email — by Ada Admin');
  assert.equal(eventText(ev('sync-recovered', null, { by: null })), 'Sync recovered — automatic');
  assert.equal(eventText(ev('something-new')), 'something-new — by Ada Admin', 'an unknown type still renders, with who');
});

test('never an email — not the old link-created detail, not anything else', () => {
  const old = ev('link-created', { userId: 'u1', fbtimePersonId: 'p1', userEmail: 'maria@org.com' }, {
    subject: { name: 'Maria Ortega', status: 'active' },
  });
  assert.doesNotMatch(eventText(old), /@/);
  const nameless = ev('link-created', { userId: 'u1', userEmail: 'maria@org.com' }, { by: { name: null }, subject: null });
  assert.equal(eventText(nameless), 'Canvasser linked', 'no name to show is no name, never the email');
});
