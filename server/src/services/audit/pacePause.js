import { PacePause } from '../../models/PacePause.js';
import { Membership } from '../../models/Membership.js';
import { Organization } from '../../models/Organization.js';
import { Campaign } from '../../models/Campaign.js';
import { User } from '../../models/User.js';
import { zonedDayRange, zonedDayStr, tzAbbrev } from '../../utils/timezone.js';
import { paceConfig, entriesOf, visitsOf, judgeVisits, findPause } from './paceRule.js';
import { loadStandingRows, loadUnitFacts } from './paceTimeline.js';
import { sendMail } from '../mail/mailer.js';
import { pacePauseAlert } from '../mail/templates.js';
import { billingNotifyRecipients } from '../mail/recipients.js';
import { userManagesCampaign } from '../authz/campaignManagement.js';

// Automatic pause — everything but the rule itself (docs/PROPOSAL_PACE_PAUSE.md §C, §D, §F). The rule is
// services/audit/paceRule.js; the rows it reads come from services/audit/paceTimeline.js.

// The refusal for a FRESH write while blocked (§C.2). Shown verbatim by every installed phone: api.js builds
// its error from `error`, and recordAction.js alerts it.
export const PACE_PAUSED = {
  status: 403,
  code: 'PACE_PAUSED',
  message: 'Recording is paused for review. Call your team lead.',
};

// ── The switch (§C.1) ───────────────────────────────────────────────────────────────────────────────
// PACE_PAUSE: unset/off = nothing runs and nothing blocks; on = every customer org (never an internal one);
// orgs:<slug,…> = only those orgs, internal ones allowed — the device check before go-live. Anything else
// counts as off, with one warning. Read on every call, so a config-var change (which restarts the dynos
// anyway) and the tests both see the current value.
const warnedSwitch = new Set();
export const paceSwitch = (raw = process.env.PACE_PAUSE) => {
  const v = String(raw ?? '').trim();
  if (!v || v === 'off') return { mode: 'off' };
  if (v === 'on') return { mode: 'on' };
  if (v.startsWith('orgs:')) {
    const slugs = new Set(v.slice(5).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    if (slugs.size) return { mode: 'orgs', slugs };
  }
  if (!warnedSwitch.has(v)) {
    warnedSwitch.add(v);
    console.warn(`[pace] PACE_PAUSE=${v} is not on, off or orgs:<slug,…> — treated as off`);
  }
  return { mode: 'off' };
};

export const switchCovers = (org, sw = paceSwitch()) => {
  if (!org) return false;
  if (sw.mode === 'on') return !org.isInternal;
  if (sw.mode === 'orgs') return sw.slugs.has(String(org.slug || '').toLowerCase());
  return false;
};

export const orgEnabled = (org) => org?.pacePause?.enabled !== false;

// Only canvassers are ever judged or blocked (decision 13): admins and leads review and unpause, and they
// enter paper results door by door. A super admin without a membership has no role here.
export const judgedMember = (membership) => membership?.role === 'canvasser' && membership.isActive !== false;

const covered = (org, membership) => Boolean(org) && judgedMember(membership) && switchCovers(org) && orgEnabled(org);

// ── The ONE predicate (§C.1) ────────────────────────────────────────────────────────────────────────
// "Is this person blocked" for the gate, every phone answer, the badges and the review screens. With the
// switch off, the org's setting off, or the member no longer a canvasser, the answer is no — so the kill
// switch reaches updated phones (their local block reads this answer), not only the server.
export const paceBlocks = async (org, membership) => {
  if (!covered(org, membership)) return false;
  return Boolean(await PacePause.exists({ organizationId: org._id, userId: membership.userId, status: 'paused' }));
};

// Is THIS pause the one blocking its member right now — per pause, never per person, so an old resolved
// record of a canvasser who is blocked by another pause never reads "blocking" (review round 2).
// `membership` is the paused member's, not the viewer's.
export const pauseIsBlocking = (org, membership, pause) => pause?.status === 'paused' && covered(org, membership);

// The phone's answer: blocked or not, stamped with server time so the phone applies answers in order.
export const paceStateOf = async (org, membership) => ({
  paused: await paceBlocks(org, membership),
  at: new Date().toISOString(),
});

// ── Restart points (§B.5) ───────────────────────────────────────────────────────────────────────────
// The latest of the member's restart point and the org's last off → on. Kept off the pause records, so
// deleting a resolved pause (decision 17) can never bring old fails back.
export const restartPointOf = (org, membership) => {
  const t = [membership?.paceRestartAt, org?.pacePause?.enabledAt]
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .reduce((a, b) => Math.max(a, b), -Infinity);
  return Number.isFinite(t) ? t : null;
};

// Move a member's restart point forward, never back.
export const moveRestartPoint = (organizationId, userId, at = new Date()) =>
  Membership.updateOne({ organizationId, userId }, { $max: { paceRestartAt: at } });

// ── The live check (§C.3) ───────────────────────────────────────────────────────────────────────────
// After a door result or a survey has been written (never a superseded or struck replay). `ts` is the tap
// time of the write just made; its day, in the campaign's zone, is the day judged. Returns the new pause,
// or null. The caller awaits it inside a try/catch: the door is saved whatever happens here.
export const runPaceCheck = async ({ org, membership, campaign, ts }) => {
  if (!campaign || !covered(org, membership)) return null;
  const userId = membership.userId;
  if (await PacePause.exists({ organizationId: org._id, userId, status: 'paused' })) return null;

  const config = paceConfig();
  const timeZone = campaign.timeZone || org.timeZone || 'America/New_York';
  const day = zonedDayStr(ts, timeZone);
  const rows = await loadStandingRows(org._id, userId, zonedDayRange(day, day, timeZone));
  if (!rows.length) return null;
  const households = await loadUnitFacts(rows.map((r) => r.householdId));
  const entries = entriesOf(rows);
  const verdicts = judgeVisits(visitsOf(entries, config), entries, { households, config }).filter(
    (v) => zonedDayStr(new Date(v.visit.first.at), timeZone) === day
  );
  const found = findPause(verdicts, { restartAt: restartPointOf(org, membership), config });
  if (!found) return null;
  return createPause({ org, userId, found, day, timeZone, config });
};

const asDate = (ms) => (ms == null ? null : new Date(ms));

// One visit of the frozen window (models/PacePause.js windowVisitSchema).
export const windowVisitOf = (v) => ({
  activityId: v.visit.standingRowId,
  householdId: v.visit.householdId,
  campaignId: v.visit.campaignId,
  result: v.visit.result,
  at: asDate(v.visit.first.at),
  prevHouseholdId: v.prev?.householdId ?? null,
  prevCampaignId: v.prev?.campaignId ?? null,
  prevResult: v.prev?.result ?? null,
  prevAt: asDate(v.prev?.at ?? null),
  gapSec: v.prev ? v.gapSec : null,
  meters: v.prev ? v.meters : null,
  effectiveMeters: v.prev ? v.effectiveMeters : null,
  neededSec: v.prev ? v.neededSec : null,
  fail: Boolean(v.fail),
  pattern: v.prev ? v.pattern : null,
  surveyCheck: v.surveyCheck
    ? { at: asDate(v.surveyCheck.at), gapSec: v.surveyCheck.gapSec, meters: v.surveyCheck.meters, neededSec: v.surveyCheck.neededSec, fail: v.surveyCheck.fail }
    : null,
});

export const createPause = async ({ org, userId, found, day, timeZone, config }) => {
  const trigger = found.trigger.visit;
  let pause;
  try {
    pause = await PacePause.create({
      organizationId: org._id,
      campaignId: trigger.campaignId,
      userId,
      status: 'paused',
      firedAt: new Date(),
      triggerActivityId: trigger.standingRowId,
      triggerAt: asDate(trigger.first.at),
      day,
      timeZone,
      config: {
        doorSec: config.doorSec,
        surveySec: config.surveySec,
        travelMps: config.travelMps,
        window: config.window,
        failsToPause: config.failsToPause,
        sameVisitSec: config.sameVisitSec,
      },
      window: found.window.map(windowVisitOf),
      alert: { status: 'pending', sent: 0, failed: 0, at: null },
    });
  } catch (err) {
    // The partial unique index: a racing write paused this canvasser a moment ago.
    if (err?.code === 11000) return null;
    throw err;
  }
  // Detached on purpose — the canvasser's write must not wait on email — and ALWAYS caught: the web process
  // has no unhandledRejection handler (only worker.js does), so a rejection would take the dyno down.
  dispatchPauseAlert(pause).catch((e) => console.error('[pace] alert dispatch failed:', e?.message || e));
  return pause;
};

// ── Resolving (§D.3) ────────────────────────────────────────────────────────────────────────────────
// Unpause resolves exactly the addressed pause, and only while it is open — so a lead can never lift a
// pause from a campaign they don't manage by posting to an old record of their own. The restart point moves
// first: a crash between the two writes leaves the pause still open, never resolved with old fails live.
export const unpause = async ({ pause, by }) => {
  const open = await PacePause.exists({ _id: pause._id, organizationId: pause.organizationId, status: 'paused' });
  if (!open) return false;
  const now = new Date();
  await moveRestartPoint(pause.organizationId, pause.userId, now);
  const res = await PacePause.updateOne(
    { _id: pause._id, organizationId: pause.organizationId, status: 'paused' },
    { $set: { status: 'resolved', resolvedAt: now, resolvedBy: by ?? null, resolvedVia: 'unpause' } }
  );
  return res.modifiedCount === 1;
};

// Every open pause in an org (`setting_off`), or every org (`switch_off`, the rollback command).
export const resolveAllOpen = async ({ organizationId = null, by = null, via }) => {
  const filter = { status: 'paused', ...(organizationId ? { organizationId } : {}) };
  const open = await PacePause.find(filter, 'organizationId userId').lean();
  const now = new Date();
  for (const p of open) {
    await moveRestartPoint(p.organizationId, p.userId, now);
    await PacePause.updateOne(
      { _id: p._id, status: 'paused' },
      { $set: { status: 'resolved', resolvedAt: now, resolvedBy: by, resolvedVia: via } }
    );
  }
  return open.length;
};

// ── The alert (§F) ──────────────────────────────────────────────────────────────────────────────────
// Who gets the email: the billing admins (unless turned off) plus the chosen org admins and leads (a lead
// only for a campaign they manage), de-duplicated by address, never the paused person. Nobody eligible →
// the billing admins once more. Returns [{ email, userId|null }].
export const pauseRecipients = async (pause) => {
  const org = await Organization.findById(pause.organizationId, 'pacePause').lean();
  const setting = org?.pacePause || {};
  const out = new Map();
  const add = (email, userId) => {
    const e = String(email || '').toLowerCase().trim();
    if (e && !out.has(e)) out.set(e, { email: e, userId: userId ? String(userId) : null });
  };

  if (setting.alertUserIds?.length) {
    const members = await Membership.find(
      { organizationId: pause.organizationId, userId: { $in: setting.alertUserIds }, isActive: true },
      'userId role'
    ).lean();
    const eligible = [];
    for (const m of members) {
      if (m.role === 'admin') eligible.push(m.userId);
      else if (m.role === 'lead' && (await userManagesCampaign(m.userId, pause.organizationId, pause.campaignId))) eligible.push(m.userId);
    }
    if (eligible.length) {
      const users = await User.find({ _id: { $in: eligible }, isActive: true, deletedAt: null }, 'email').lean();
      for (const u of users) add(u.email, u._id);
    }
  }
  if (setting.billingAdmins !== false) for (const r of await billingNotifyRecipients(pause.organizationId)) add(r.email, r.userId);

  const paused = await User.findById(pause.userId, 'email').lean();
  const pausedEmail = String(paused?.email || '').toLowerCase().trim();
  const notThePausedPerson = () => {
    for (const [e, r] of out) if (r.userId === String(pause.userId) || (pausedEmail && e === pausedEmail)) out.delete(e);
  };
  notThePausedPerson();
  if (!out.size) {
    for (const r of await billingNotifyRecipients(pause.organizationId)) add(r.email, r.userId);
    notThePausedPerson();
  }
  return [...out.values()];
};

// "on Oct 22 at 1:10 PM PDT", in the campaign's zone.
export const whenText = (date, timeZone) => {
  const d = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(date);
  const t = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date);
  return `on ${d} at ${t} ${tzAbbrev(timeZone, date)}`.trim();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Resend's default rate limit is 2 requests a second; a short gap keeps a full list inside it.
const SEND_GAP_MS = Number(process.env.PACE_ALERT_SEND_GAP_MS ?? 600);

// One email per recipient (no one sees another's address), each logged with its account when it has one.
// The outcome lands on the pause; the review screen reads it.
export const dispatchPauseAlert = async (pause) => {
  let sent = 0;
  let failed = 0;
  try {
    const [recipients, org, campaign] = await Promise.all([
      pauseRecipients(pause),
      Organization.findById(pause.organizationId, 'name').lean(),
      Campaign.findById(pause.campaignId, 'name').lean(),
    ]);
    const origin = process.env.WEB_ORIGIN || 'https://doorline.app';
    const reviewUrl = `${origin}/pause/${pause.organizationId}/${pause.campaignId}/${pause._id}`;
    const template = pacePauseAlert({
      orgName: org?.name || 'your organization',
      campaignName: campaign?.name || 'a campaign',
      when: whenText(pause.firedAt, pause.timeZone),
      reviewUrl,
    });
    for (const [i, r] of recipients.entries()) {
      if (i && SEND_GAP_MS > 0) await sleep(SEND_GAP_MS);
      const result = await sendMail({
        to: r.email,
        ...template,
        kind: 'pacePauseAlert',
        meta: { organizationId: pause.organizationId, organizationName: org?.name || null, ...(r.userId ? { userId: r.userId } : {}) },
      });
      if (result?.sent) sent += 1;
      else failed += 1;
    }
  } finally {
    await PacePause.updateOne({ _id: pause._id }, { $set: { alert: { status: 'done', sent, failed, at: new Date() } } });
  }
};

// ── Badges (§F.5) ───────────────────────────────────────────────────────────────────────────────────
// Blocking pauses per campaign: open, in an org the switch covers with the setting on, of a member who is
// still an active canvasser (paceBlocks' own terms, so a badge never shows a pause that blocks no one).
// Returns Map<campaignIdStr, n>; empty for nearly every org.
export const openPausesByCampaign = async (organizationId, campaignIds) => {
  const out = new Map();
  if (!campaignIds.length) return out;
  const org = await Organization.findById(organizationId, 'slug isInternal pacePause').lean();
  if (!switchCovers(org) || !orgEnabled(org)) return out;
  const open = await PacePause.find(
    { organizationId, status: 'paused', campaignId: { $in: campaignIds } },
    'campaignId userId'
  ).lean();
  if (!open.length) return out;
  const canvassers = await Membership.find(
    { organizationId, userId: { $in: open.map((p) => p.userId) }, isActive: true, role: 'canvasser' },
    'userId'
  ).lean();
  const live = new Set(canvassers.map((m) => String(m.userId)));
  for (const p of open) {
    if (!live.has(String(p.userId))) continue;
    const k = String(p.campaignId);
    out.set(k, (out.get(k) || 0) + 1);
  }
  return out;
};

// ── Boot (§D.2) ─────────────────────────────────────────────────────────────────────────────────────
// Production autoIndex is off, and the partial unique index is what keeps a canvasser to one open pause,
// so both dynos build it before they can write one (the client-report collections' pattern,
// services/reports/clientReportIndexes.js). syncIndexes is idempotent.
export const syncPacePauseIndexes = async (tag = 'boot') => {
  await PacePause.syncIndexes().catch((e) => console.error(`[${tag}] PacePause.syncIndexes failed`, e?.message || e));
};
