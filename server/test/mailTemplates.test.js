import { test, after } from 'node:test';
import assert from 'node:assert';
import * as t from '../src/services/mail/templates.js';
import { installLinks } from '../src/config/storeLinks.js';

// Who gets told to install the app — pure, no database, and deliberately NOT an .int test so it
// runs on `npm test` and can never silently skip. Every other assertion about email content goes
// through a route + mongod and is skipped whenever MONGODB_URI_TEST is unset, which is exactly how
// a canvasser ended up with an email pointing at a web console they can't use.
//
// The rule: a `canvasser` works in the mobile app and gets install links. An `admin` or `lead`
// works in the web console and must never be told to install a field app. An ABSENT role renders
// the console version — the fail-safe direction.

const { ios, android } = installLinks();
const both = (r) => `${r.html}\n${r.text}`;
const hasLinks = (r) => both(r).includes(ios) && both(r).includes(android);

const BASE = {
  firstName: 'Stephen',
  orgName: 'Fox Bryant LLC',
  campaignName: 'Florida - HD54',
  setPasswordUrl: 'https://doorline.app/reset-password/TOKEN',
};

test('inviteSetPassword: a canvasser gets both install links, in HTML and plain text', () => {
  const r = t.inviteSetPassword({ ...BASE, role: 'canvasser' });
  assert.ok(r.html.includes(ios), 'iOS link in html');
  assert.ok(r.html.includes(android), 'Android link in html');
  assert.ok(r.text.includes(ios), 'iOS link in text');
  assert.ok(r.text.includes(android), 'Android link in text');
  // The closing note — the recovery path when a store link can't hand off to the phone's store.
  // Checked per HALF on purpose: both() concatenates them, so the old form could not have caught
  // the note falling out of one side only, which is the drift this file exists to catch.
  for (const [half, body] of [['html', r.html], ['text', r.text]]) {
    assert.ok(body.includes('App Store'), `store-search fallback missing from ${half}`);
    assert.ok(body.includes('Google Play'), `store-search fallback missing from ${half}`);
  }
  // Both apps went public 2026-07-28. Asserts the phrase, not /beta|testflight/ — those can appear
  // inside an env-supplied URL and would make this depend on the developer's ambient shell.
  assert.ok(!both(r).includes('closed test'), 'the beta-era note is gone');
  // The password CTA is still the point of this email.
  assert.ok(r.html.includes(BASE.setPasswordUrl), 'set-password link survives');
});

test('inviteSetPassword: admin, lead, and an ABSENT role get no install links', () => {
  for (const role of ['admin', 'lead', undefined, null, '']) {
    const r = t.inviteSetPassword({ ...BASE, role });
    assert.ok(!both(r).includes(ios), `iOS link leaked to role=${String(role)}`);
    assert.ok(!both(r).includes(android), `Android link leaked to role=${String(role)}`);
  }
});

test('addedToCampaign: canvasser yes, lead no', () => {
  assert.ok(hasLinks(t.addedToCampaign({ ...BASE, role: 'canvasser' })));
  assert.ok(!both(t.addedToCampaign({ ...BASE, role: 'lead' })).includes(ios));
});

test('addedToOrg: a canvasser is never told to "switch into it"', () => {
  // "switch into it" is the console org-picker — a concept a canvasser has no access to.
  const canvasser = t.addedToOrg({ ...BASE, role: 'canvasser' });
  assert.ok(hasLinks(canvasser), 'canvasser gets the links');
  assert.ok(!both(canvasser).includes('switch into it'), 'no console-only wording');

  const admin = t.addedToOrg({ ...BASE, role: 'admin' });
  assert.ok(!both(admin).includes(ios), 'admin gets no links');
  assert.ok(both(admin).includes('switch into it'), 'admin keeps the picker wording');
});

test('provisioningWelcome never carries install links — it is always an org first admin', () => {
  for (const role of ['canvasser', 'admin', undefined]) {
    const r = t.provisioningWelcome({ ...BASE, role });
    assert.ok(!both(r).includes(ios), `iOS link leaked at role=${String(role)}`);
    assert.ok(!both(r).includes(android), `Android link leaked at role=${String(role)}`);
  }
});

test('every template still returns a complete {subject, html, text}', () => {
  const made = [
    t.inviteSetPassword({ ...BASE, role: 'canvasser' }),
    t.addedToOrg({ ...BASE, role: 'canvasser' }),
    t.addedToCampaign({ ...BASE, role: 'canvasser' }),
  ];
  for (const r of made) {
    assert.ok(r.subject && typeof r.subject === 'string');
    assert.ok(r.html.includes('<table'), 'html is the table layout');
    assert.ok(r.text.trim().endsWith('— Doorline'), 'text is a standalone alternative');
    assert.ok(!r.text.includes('<'), 'text carries no markup');
  }
});

// ---- env override + the raw/escaped split -------------------------------------

const SAVED = process.env.MOBILE_INSTALL_URL_ANDROID;
after(() => {
  if (SAVED === undefined) delete process.env.MOBILE_INSTALL_URL_ANDROID;
  else process.env.MOBILE_INSTALL_URL_ANDROID = SAVED;
});

test('install URLs are env-overridable, and & is escaped in HTML but raw in text', () => {
  // A public Play listing URL carries query params, so this is the shape that ships at launch —
  // and the one that catches a mix-up between appLinks() (escapes) and appLinksText() (raw).
  process.env.MOBILE_INSTALL_URL_ANDROID = 'https://x.test/a?id=pkg&hl=en';
  const r = t.addedToCampaign({ ...BASE, role: 'canvasser' });
  assert.ok(r.html.includes('id=pkg&amp;hl=en'), 'HTML escapes the ampersand');
  assert.ok(!r.html.includes('id=pkg&hl=en'), 'HTML must not carry a bare &');
  assert.ok(r.text.includes('id=pkg&hl=en'), 'plain text carries the raw URL');
  assert.ok(!r.text.includes('&amp;'), 'plain text must not be HTML-escaped');
});
