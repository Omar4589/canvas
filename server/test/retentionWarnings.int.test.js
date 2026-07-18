import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Deletion WARNINGS — the "we tell you before your data goes" half of the retention promise.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/rwarn node --test test/retentionWarnings.int.test.js
//
// The invariant under test: the wind-down and dormancy purges NEVER delete an org that was not
// actually warned. "Warned" is earned, not assumed — the marker is stamped only when the warning
// email was ACCEPTED for delivery (mailer returns sent: true) or the org has no reachable
// recipient at all. A dormant mailer (no RESEND_API_KEY — every fresh deploy), a failed send, a
// dry run: none of them stamp, so none of them ever license a deletion. These tests drive the
// mailer's test transport (RESEND_API_KEY = 'test:accept' / 'test:reject') to exercise both
// delivery outcomes without a network.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-retention-warnings';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { User } = await import('../src/models/User.js');
const { RetentionRun } = await import('../src/models/RetentionRun.js');
const {
  runRetentionTriggers, warnWindDownOrgs, warnDormantOrgs, purgeWoundDownOrgs, purgeDormantOrgs,
  WIND_DOWN_DAYS, DORMANCY_MONTHS, WARN_LEAD_DAYS, WARN_GRACE_DAYS,
} = await import('../src/services/retention/triggers.js');
const { windDownDeletionDate } = await import('../src/services/billing/windDown.js');
const { outbox, clearOutbox } = await import('../src/services/mail/mailer.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const DAY = 86_400_000;

// Flip the mailer between its three worlds. 'dormant' = a fresh keyless deploy; 'accept' /
// 'reject' = the test transport emulating a Resend 2xx / failure. Env is read per-send, so
// this works mid-process.
function setMail(mode) {
  if (mode === 'dormant') {
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
  } else {
    process.env.RESEND_API_KEY = `test:${mode}`;
    process.env.MAIL_FROM = 'Doorline <notifications@doorline.test>';
  }
}

// Orgs here get a billingContact email so billingNotifyEmails() finds a recipient — a warn test
// against a recipient-less org would silently exercise the zero-recipient stamp path instead.
// (Recipients are billing-identities ONLY — billingAccess admins, else the billing contact;
// plain admins never receive deletion warnings. Owner decision 2026-07-18.)
async function makeOrg(name, slug, subStatus, statusChangedAt = new Date(), { contact = true } = {}) {
  const org = await Organization.create({ name, slug, isActive: true });
  await Subscription.create({
    organizationId: org._id, status: subStatus, statusChangedAt,
    ...(contact ? { billingContact: { name: 'Owner', email: `owner@${slug}.test` } } : {}),
  });
  return org;
}

// A knock at `at`, so dormancy has a real lastTouch to measure from.
async function knockAt(org, at) {
  const camp = await Campaign.create({ organizationId: org._id, name: 'C', type: 'survey', state: 'FL', isActive: true });
  const hh = await Household.create({
    organizationId: org._id, campaignId: camp._id,
    addressLine1: '1 Elm', city: 'T', state: 'FL', zipCode: '1',
    normalizedAddress: `1 ELM|${org.slug}-${Date.now()}`,
    location: { type: 'Point', coordinates: [-81, 28] },
  });
  const u = await User.create({
    firstName: 'C', lastName: 'V', email: `c-${org.slug}-${Math.random().toString(36).slice(2, 8)}@t.co`,
    passwordHash: 'x', isActive: true,
  });
  await CanvassActivity.create({
    organizationId: org._id, campaignId: camp._id, householdId: hh._id, userId: u._id,
    actionType: 'not_home', timestamp: at, location: { lat: 28, lng: -81 },
  });
}

const ageOrg = (org, at) =>
  Organization.collection.updateOne({ _id: org._id }, { $set: { createdAt: at } });

const subOf = (org) => Subscription.findOne({ organizationId: org._id }).lean();
const orgFresh = (org) => Organization.findById(org._id).lean();

// The templates print dates long-form en-US in UTC; mirror that to assert the email names the
// exact date the purge will honor.
const longDate = (d) =>
  new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

let server;
let base;
let superTok;

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});
beforeEach(async () => {
  if (!URI) return;
  for (const M of [Organization, Subscription, Campaign, Household, Voter, CanvassActivity, User, RetentionRun]) {
    await M.deleteMany({});
  }
  clearOutbox();
  setMail('dormant');
  const superU = await User.create({
    firstName: 'Sue', lastName: 'Super', email: 'super@t.co', passwordHash: 'x', isActive: true, isSuperAdmin: true,
  });
  superTok = signUserToken(superU);
});

test('WARN (wind-down): one warning inside the lead window; the promised date IS the banner date; never twice', { skip }, async () => {
  setMail('accept');
  // Deletion 20 days out: inside WARN_LEAD_DAYS (30), beyond WARN_GRACE_DAYS (14) — the normal
  // nightly case, where the promised date must equal the banner's wind-down date exactly.
  const soon = await makeOrg('Leaving Soon', 'leaving', 'canceled', new Date(Date.now() - (WIND_DOWN_DAYS - 20) * DAY));
  // Deletion ~59 days out: beyond the lead window — not warned yet.
  const fresh = await makeOrg('Just Canceled', 'fresh-cxl', 'canceled', new Date(Date.now() - 1 * DAY));

  const res = await warnWindDownOrgs({ apply: true });
  assert.strictEqual(res.warned, 1);

  const sub = await subOf(soon);
  assert.ok(sub.windDownWarnedAt, 'marker stamped on accepted delivery');
  assert.strictEqual(
    new Date(sub.windDownDeleteNotBefore).getTime(),
    windDownDeletionDate(sub.statusChangedAt).getTime(),
    'the promised date is the SAME date the banner shows — one helper, no drift'
  );
  assert.strictEqual((await subOf(fresh)).windDownWarnedAt, null, 'outside the lead window → not warned yet');

  const mails = outbox.filter((m) => m.kind === 'windDownWarning');
  assert.strictEqual(mails.length, 1);
  assert.ok(mails[0].to.includes('owner@leaving.test'));
  assert.ok(
    mails[0].text.includes(longDate(sub.windDownDeleteNotBefore)),
    'the email names the exact date the purge will honor'
  );

  // Second sweep: marker set → nothing new goes out. Warn once, not nightly.
  const again = await warnWindDownOrgs({ apply: true });
  assert.strictEqual(again.warned, 0);
  assert.strictEqual(outbox.filter((m) => m.kind === 'windDownWarning').length, 1);
});

test('NEVER DELETE UNWARNED: dormant mail cannot stamp; delivery stamps with full grace; purge only after both gates', { skip }, async () => {
  // Long overdue — under the OLD code this org would be purged tonight. Mail is dormant (a
  // fresh deploy with no RESEND_API_KEY): the sweep must neither stamp nor delete.
  const overdue = await makeOrg('Overdue Org', 'overdue', 'canceled', new Date(Date.now() - (WIND_DOWN_DAYS + 5) * DAY));

  let sweep = await runRetentionTriggers({ apply: true });
  assert.strictEqual(sweep.warnWindDown.warned, 0, 'dormant mailer → no delivery → no stamp');
  assert.strictEqual(sweep.windDown.purged, 0, 'unwarned → NOT purged, however overdue');
  assert.ok(await orgFresh(overdue), 'org survives the dormant-mail window');
  assert.strictEqual((await subOf(overdue)).windDownWarnedAt, null);
  assert.ok(outbox.some((m) => m.kind === 'windDownWarning'), 'the attempt is visible (dormant outbox), just not binding');

  // Mail goes live → the warning is delivered and stamped, promising max(banner date, now+grace):
  // the banner date is in the past, so the customer gets the FULL grace, not a same-day purge.
  setMail('accept');
  sweep = await runRetentionTriggers({ apply: true });
  assert.strictEqual(sweep.warnWindDown.warned, 1);
  assert.strictEqual(sweep.windDown.purged, 0, 'freshly warned → grace not elapsed → still not purged');
  const sub = await subOf(overdue);
  assert.ok(sub.windDownWarnedAt);
  const graceMs = new Date(sub.windDownDeleteNotBefore).getTime() - Date.now();
  assert.ok(
    graceMs > (WARN_GRACE_DAYS - 1) * DAY && graceMs <= WARN_GRACE_DAYS * DAY,
    `an overdue org is promised the full ${WARN_GRACE_DAYS}-day grace from warn time`
  );

  // Age the warning past the grace → NOW the purge may fire.
  await Subscription.updateOne(
    { organizationId: overdue._id },
    {
      $set: {
        windDownWarnedAt: new Date(Date.now() - (WARN_GRACE_DAYS + 1) * DAY),
        windDownDeleteNotBefore: new Date(Date.now() - 1 * DAY),
      },
    }
  );
  sweep = await runRetentionTriggers({ apply: true });
  assert.strictEqual(sweep.windDown.purged, 1, 'warned + grace elapsed + overdue → purged');
  assert.strictEqual(await Organization.countDocuments({ _id: overdue._id }), 0);
});

test('a FAILED send never stamps — retried on every sweep until it actually delivers', { skip }, async () => {
  setMail('reject');
  const org = await makeOrg('Bad Mail Day', 'bad-mail', 'canceled', new Date(Date.now() - (WIND_DOWN_DAYS + 5) * DAY));

  let res = await warnWindDownOrgs({ apply: true });
  assert.strictEqual(res.warned, 0, 'rejected send → no stamp');
  assert.strictEqual((await subOf(org)).windDownWarnedAt, null);
  assert.ok(await orgFresh(org));

  res = await warnWindDownOrgs({ apply: true });
  assert.strictEqual(res.due, 1, 'still due — the sweep keeps retrying, unstamped');
  assert.strictEqual(outbox.filter((m) => m.kind === 'windDownWarning').length, 2, 'one attempt per sweep');

  setMail('accept');
  res = await warnWindDownOrgs({ apply: true });
  assert.strictEqual(res.warned, 1, 'first ACCEPTED delivery stamps');
});

test('ZERO reachable recipients: stamped without an email — nothing will ever be deliverable', { skip }, async () => {
  // No members, no billing contact (already torn down by hand). Waiting for a deliverable
  // warning would mean holding their data forever; the stamp is taken with a loud log instead.
  const ghost = await makeOrg('No Contacts', 'no-contacts', 'canceled',
    new Date(Date.now() - (WIND_DOWN_DAYS + 5) * DAY), { contact: false });

  const res = await warnWindDownOrgs({ apply: true }); // mail still DORMANT — irrelevant here
  assert.strictEqual(res.warned, 1);
  const sub = await subOf(ghost);
  assert.ok(sub.windDownWarnedAt, 'marker stamped despite no recipients');
  assert.strictEqual(outbox.length, 0, 'and no email was even attempted');
});

test('a billing status change CLEARS both markers — the canceled→warned→comped→re-canceled trap', { skip }, async () => {
  setMail('accept');
  const org = await makeOrg('Comped Back', 'comped', 'canceled', new Date(Date.now() - (WIND_DOWN_DAYS - 5) * DAY));
  await warnWindDownOrgs({ apply: true });
  // Simulate an outstanding dormancy warning too — the status change must clear BOTH kinds.
  await Organization.updateOne(
    { _id: org._id },
    { $set: { dormancyWarnedAt: new Date(), dormancyDeleteNotBefore: new Date(Date.now() + 5 * DAY) } }
  );
  assert.ok((await subOf(org)).windDownWarnedAt, 'precondition: warned');

  // The real chokepoint route, not a direct DB write — any future status writer goes through it.
  const res = await fetch(`${base}/api/super-admin/organizations/${org._id}/billing/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superTok}` },
    body: JSON.stringify({ to: 'active' }),
  });
  assert.strictEqual(res.status, 200);

  const sub = await subOf(org);
  const fresh = await orgFresh(org);
  assert.strictEqual(sub.windDownWarnedAt, null, 'wind-down marker cleared on status change');
  assert.strictEqual(sub.windDownDeleteNotBefore, null);
  assert.strictEqual(fresh.dormancyWarnedAt, null, 'dormancy marker cleared too — a warning sent to a then-canceled org must not survive reactivation');
  assert.strictEqual(fresh.dormancyDeleteNotBefore, null);

  // Re-cancel: the old warning is gone, so nothing may purge until a FRESH warn + grace.
  const cancel = await fetch(`${base}/api/super-admin/organizations/${org._id}/billing/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superTok}` },
    body: JSON.stringify({ to: 'canceled', reason: 'left again' }),
  });
  assert.strictEqual(cancel.status, 200);
  await Subscription.updateOne(
    { organizationId: org._id },
    { $set: { statusChangedAt: new Date(Date.now() - (WIND_DOWN_DAYS + 5) * DAY) } }
  );
  const purge = await purgeWoundDownOrgs({ apply: true });
  assert.strictEqual(purge.purged, 0, 're-canceled but re-warned never → must not purge');
  assert.ok(await orgFresh(org));
});

test('DORMANCY: warn inside the lead window only; purge honors the promised date; activity voids the warning', { skip }, async () => {
  setMail('accept');
  const boundaryDays = DORMANCY_MONTHS * 30;

  // 10 days of runway left → inside the lead window → warned.
  const closing = await makeOrg('Going Quiet', 'quiet', 'suspended');
  await ageOrg(closing, new Date(Date.now() - (boundaryDays + 200) * DAY));
  await knockAt(closing, new Date(Date.now() - (boundaryDays - 10) * DAY));

  // 100 days of runway → outside the lead window → left alone.
  const runway = await makeOrg('Still Time', 'runway', 'suspended');
  await ageOrg(runway, new Date(Date.now() - (boundaryDays + 200) * DAY));
  await knockAt(runway, new Date(Date.now() - (boundaryDays - 100) * DAY));

  // A PAYING org this close to the boundary is never even warned — protected status.
  const paying = await makeOrg('Paying Quiet', 'paying-quiet', 'active');
  await ageOrg(paying, new Date(Date.now() - (boundaryDays + 200) * DAY));
  await knockAt(paying, new Date(Date.now() - (boundaryDays - 10) * DAY));

  const res = await warnDormantOrgs({ apply: true });
  assert.strictEqual(res.warned, 1, 'only the non-protected org inside the lead window');
  assert.ok((await orgFresh(closing)).dormancyWarnedAt);
  assert.strictEqual((await orgFresh(runway)).dormancyWarnedAt, null);
  assert.strictEqual((await orgFresh(paying)).dormancyWarnedAt, null);
  assert.strictEqual(outbox.filter((m) => m.kind === 'dormancyWarning').length, 1);

  // Warned, then the org knocks a door — exactly what the email says cancels the deletion.
  await knockAt(closing, new Date());
  const purge = await purgeDormantOrgs({ apply: true });
  assert.strictEqual(purge.purged, 0);
  const cleared = await orgFresh(closing);
  assert.strictEqual(cleared.dormancyWarnedAt, null, 'activity after the warning clears the marker');
  assert.strictEqual(cleared.dormancyDeleteNotBefore, null);
});

test('DORMANCY: warned + past boundary + past promised date → purged; before the promised date → held', { skip }, async () => {
  setMail('accept');
  const boundaryDays = DORMANCY_MONTHS * 30;
  const gone = await makeOrg('Long Gone', 'long-gone', 'canceled');
  await ageOrg(gone, new Date(Date.now() - (boundaryDays + 100) * DAY));
  await knockAt(gone, new Date(Date.now() - (boundaryDays + 40) * DAY));

  await warnDormantOrgs({ apply: true });
  const warned = await orgFresh(gone);
  assert.ok(warned.dormancyWarnedAt, 'overdue org warned on first live sweep');

  let purge = await purgeDormantOrgs({ apply: true });
  assert.strictEqual(purge.purged, 0, 'promised date (warn + grace) not reached → held');

  await Organization.updateOne(
    { _id: gone._id },
    {
      $set: {
        dormancyWarnedAt: new Date(Date.now() - (WARN_GRACE_DAYS + 1) * DAY),
        dormancyDeleteNotBefore: new Date(Date.now() - 1 * DAY),
      },
    }
  );
  purge = await purgeDormantOrgs({ apply: true });
  assert.strictEqual(purge.purged, 1, 'warned + grace elapsed → purged');
  assert.strictEqual(await Organization.countDocuments({ _id: gone._id }), 0);
});

test('INTERNAL orgs are never warned — no scare email to our own demo tenant', { skip }, async () => {
  setMail('accept');
  const demo = await makeOrg('Demo Org', 'demo-internal', 'internal', new Date(Date.now() - (WIND_DOWN_DAYS + 400) * DAY));
  await ageOrg(demo, new Date(Date.now() - (DORMANCY_MONTHS * 30 + 400) * DAY));

  const sweep = await runRetentionTriggers({ apply: true });
  assert.strictEqual(sweep.warned, 0);
  assert.strictEqual(outbox.length, 0);
  assert.ok(await orgFresh(demo));
});

test('DRY RUN: counts the due, sends nothing, stamps nothing', { skip }, async () => {
  setMail('accept'); // even with delivery available, a dry run must not touch a customer
  const org = await makeOrg('Dry Run Org', 'dry-run', 'canceled', new Date(Date.now() - (WIND_DOWN_DAYS + 5) * DAY));

  const sweep = await runRetentionTriggers({ apply: false });
  assert.ok(sweep.warnWindDown.due >= 1, 'the dry run still reports what WOULD be warned');
  assert.strictEqual(sweep.warned, 0);
  assert.strictEqual(outbox.length, 0, 'no email on a dry run, ever');
  assert.strictEqual((await subOf(org)).windDownWarnedAt, null);
  assert.ok(await orgFresh(org));
});

test('every applied sweep receipts its warns — RetentionRun.warned', { skip }, async () => {
  setMail('accept');
  await makeOrg('Receipt Org', 'receipt', 'canceled', new Date(Date.now() - (WIND_DOWN_DAYS - 5) * DAY));
  await runRetentionTriggers({ apply: true });
  const run = await RetentionRun.findOne({}).sort({ startedAt: -1 }).lean();
  assert.strictEqual(run.warned, 1, 'the receipt records that a warning went out');
});

test('the warn windows are CONFIGURABLE, not hardcoded', { skip }, () => {
  assert.strictEqual(WARN_LEAD_DAYS, Number(process.env.RETENTION_WARN_LEAD_DAYS || 30));
  assert.strictEqual(WARN_GRACE_DAYS, Number(process.env.RETENTION_WARN_GRACE_DAYS || 14));
});
