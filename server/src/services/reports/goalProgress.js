import { Organization } from '../../models/Organization.js';
import { Pass } from '../../models/Pass.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { knocksPipeline, billableDoorsOf } from './aggregations.js';
import { resolveBillRestricted } from './billRestricted.js';
import { zonedDayRange, zonedDayStr } from '../../utils/timezone.js';

// Door-goal progress and pace — the ONE owner of this math. Every surface (the campaigns list,
// the campaign rollup that feeds both dashboards, the client report) reads a block from here;
// nothing re-derives "how many a day do we need" locally, because three copies of that
// arithmetic is three chances to disagree about what a door is.
//
// The unit is BILLABLE DOORS (docs/METRICS.md): knocks, plus restricted-only doors when the
// campaign bills them. That is deliberate — a goal is a contract number, so it has to be the
// same number the invoice uses. Resolution always goes through billRestricted.js.
//
// Two things are load-bearing enough to spell out:
//
//   1. `done` is ALL-TIME and campaign-wide, always. The rollup row this rides on honors
//      from/to/effortId/coordinatorId; this block must not, or "3,412 / 10,000" silently
//      becomes "3,412 this week" the moment someone touches the date picker.
//   2. Days are CALENDAR days on BOTH sides of the comparison (owner ruling 2026-08-14 — no
//      canvass-weekday pattern). That is what makes it honest: if the crew takes Sundays off,
//      the required rate and the actual rate absorb the day off equally.

// Trailing window for the "what are we actually doing" rate.
export const PACE_WINDOW_DAYS = 14;
// Below this many days of canvassing history we report the required rate but NO verdict. A
// campaign that activated its first round on Tuesday would otherwise divide two days of doors
// by fourteen and read "behind" — a false alarm about a campaign that is doing fine, which is
// the failure mode that makes people stop trusting a number.
export const MIN_PACE_DAYS = 5;
// Past this, a projection is noise dressed up as a date.
const MAX_PROJECTION_DAYS = 365;

// 'YYYY-MM-DD' civil-date arithmetic, matching client/src/lib/electionDates.js. Anchored at
// UTC noon-free Date.UTC deltas so it never touches a real timezone — these are civil dates,
// and the zone they mean is already baked into the strings by the caller.
const civilParts = (dayStr) => String(dayStr).split('-').map(Number);

// Whole days from `a` to `b`. Negative when b is before a.
export function daysBetween(a, b) {
  const [ay, am, ad] = civilParts(a);
  const [by, bm, bd] = civilParts(b);
  return (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000;
}

export function addDays(dayStr, n) {
  const [y, m, d] = civilParts(dayStr);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// The date the goal is measured against. A campaign that only ever set an Election Day still
// gets a countdown and a pace — the explicit goalDate exists for the common case of wanting the
// universe walked BEFORE election day (GOTV), not to make people type the date twice.
export function deadlineFor(campaign) {
  if (campaign?.goalDate) return { deadline: campaign.goalDate, deadlineSource: 'goalDate' };
  if (campaign?.electionDay) return { deadline: campaign.electionDay, deadlineSource: 'electionDay' };
  return { deadline: null, deadlineSource: null };
}

// Whole-percent progress. Never rounds UP to 100 while doors remain — a bar reading 100% on an
// unfinished goal is the one lie a progress bar can tell. Exported so the frozen client-report
// snapshot computes it the same way the live card does.
export function goalPercent(done, target) {
  if (!(target > 0)) return 0;
  if (done >= target) return 100;
  return Math.min(99, Math.round((done / target) * 100));
}

// PURE. Everything the clients render, computed from numbers the caller already has.
// `recentDoors` / `windowDays` describe the trailing window; pass windowDays 0 when the
// campaign has not started canvassing.
export function computeGoalPace({
  target,
  done = 0,
  deadline = null,
  deadlineSource = null,
  todayStr,
  recentDoors = 0,
  windowDays = 0,
}) {
  const remaining = Math.max(0, target - done);
  const percent = goalPercent(done, target);
  const daysLeft = deadline ? daysBetween(todayStr, deadline) : null;

  // +1 because a deadline of today still leaves today to knock.
  const daysUsable = daysLeft == null ? null : Math.max(1, daysLeft + 1);
  const requiredPerDay =
    remaining > 0 && daysUsable != null && daysLeft >= 0 ? Math.ceil(remaining / daysUsable) : null;
  // Null inside the last week: "2,713 a week" with three days left is arithmetic nobody can act
  // on, and it reads as a bigger number than the goal itself.
  const requiredPerWeek =
    remaining > 0 && daysUsable != null && daysLeft >= 0 && daysUsable >= 7
      ? Math.ceil(remaining / (daysUsable / 7))
      : null;

  const rawRecentPerDay = windowDays > 0 ? recentDoors / windowDays : 0;

  let verdict;
  if (done >= target) verdict = 'complete';
  else if (!deadline) verdict = 'no_deadline';
  else if (daysLeft < 0) verdict = 'past_due';
  else if (windowDays < MIN_PACE_DAYS || recentDoors <= 0) verdict = 'no_pace';
  else {
    const ratio = rawRecentPerDay / requiredPerDay;
    if (ratio >= 1.05) verdict = 'ahead';
    else if (ratio >= 0.95) verdict = 'on_track';
    else verdict = 'behind';
  }

  const judged = verdict === 'ahead' || verdict === 'on_track' || verdict === 'behind';
  let projectedFinish = null;
  let projectedDaysLate = null;
  if (judged && rawRecentPerDay > 0) {
    const daysToFinish = Math.ceil(remaining / rawRecentPerDay);
    if (daysToFinish <= MAX_PROJECTION_DAYS) {
      projectedFinish = addDays(todayStr, daysToFinish);
      const late = daysBetween(deadline, projectedFinish);
      if (late > 0) projectedDaysLate = late;
    }
  }

  return {
    target,
    deadline,
    deadlineSource,
    done,
    remaining,
    percent,
    daysLeft,
    requiredPerDay,
    requiredPerWeek,
    // Integer for display. The verdict above compares the UNROUNDED rate, so a campaign doing
    // 0.4/day is judged on 0.4 even though the card reads 0.
    recentPerDay: judged || verdict === 'no_pace' ? Math.round(rawRecentPerDay) : null,
    paceWindowDays: windowDays || 0,
    verdict,
    projectedFinish,
    projectedDaysLate,
  };
}

// Progress blocks for a set of campaigns, keyed by String(_id). Campaigns without a goal are
// absent from the Map — callers emit `goal: null` for those.
//
// `campaigns` are lean docs carrying at least _id, doorGoal, goalDate, electionDay, timeZone,
// stats and billRestrictedDoors. `orgDefaults` is the org's { billRestrictedDoors } (fetched
// here when the caller doesn't already hold it).
export async function goalProgressFor({ organizationId, campaigns = [], orgDefaults, now = new Date() }) {
  const withGoal = campaigns.filter((c) => Number(c?.doorGoal) > 0);
  // The whole point of this guard: an org with no goals pays NOTHING for this feature, and in
  // particular the rollup's free Campaign.stats fast path stays free.
  if (!withGoal.length) return new Map();

  const org =
    orgDefaults !== undefined
      ? orgDefaults
      : await Organization.findById(organizationId, { billRestrictedDoors: 1 }).lean();

  const policyOf = new Map(
    withGoal.map((c) => [String(c._id), resolveBillRestricted(c, org)])
  );
  const ids = withGoal.map((c) => c._id);

  // ── Doors done, all-time ────────────────────────────────────────────────────────────────
  // Seeded campaigns read straight off the denormalized counters. Legacy docs whose stats were
  // never reconciled (stats.reconciledAt null) fall back to the live pipeline, for those docs
  // only — the counters are exact or unused, never approximate.
  const done = new Map();
  const unseeded = [];
  for (const c of withGoal) {
    const key = String(c._id);
    if (c.stats?.reconciledAt) {
      const knocks = c.stats.knockCount || 0;
      const restricted = c.stats.restrictedDoorCount || 0;
      done.set(key, knocks + (policyOf.get(key) ? restricted : 0));
    } else {
      unseeded.push(c._id);
    }
  }
  if (unseeded.length) {
    const rows = await CanvassActivity.aggregate(
      knocksPipeline(
        { organizationId, campaignId: { $in: unseeded } },
        { byCampaign: true, includeRestricted: true }
      )
    );
    for (const id of unseeded) done.set(String(id), 0);
    for (const row of rows) {
      const key = String(row._id);
      done.set(key, billableDoorsOf(row, policyOf.get(key)));
    }
  }

  // ── How long this campaign has actually been canvassing ─────────────────────────────────
  // The earliest activated round. Bounded and tiny (a handful of rounds per campaign), and
  // more honest than "first knock" anyway: pace starts when the round goes live.
  const firstActivated = new Map();
  const passes = await Pass.find(
    { campaignId: { $in: ids }, activatedAt: { $ne: null } },
    { campaignId: 1, activatedAt: 1 }
  ).lean();
  for (const p of passes) {
    const key = String(p.campaignId);
    const prev = firstActivated.get(key);
    if (!prev || p.activatedAt < prev) firstActivated.set(key, p.activatedAt);
  }

  // ── Trailing-window doors ───────────────────────────────────────────────────────────────
  // One pipeline per distinct timezone (normally one). Day boundaries have to be the
  // campaign's own — a rollup can span zones, which is why the rollup itself carries a
  // crossZoneDaySeam warning.
  const byZone = new Map();
  for (const c of withGoal) {
    const tz = c.timeZone || 'America/New_York';
    if (!byZone.has(tz)) byZone.set(tz, []);
    byZone.get(tz).push(c);
  }

  const blocks = new Map();
  await Promise.all(
    [...byZone.entries()].map(async ([tz, zoneCampaigns]) => {
      const todayStr = zonedDayStr(now, tz);
      const windowFrom = addDays(todayStr, -(PACE_WINDOW_DAYS - 1));
      const zoneIds = zoneCampaigns.map((c) => c._id);
      const rows = await CanvassActivity.aggregate(
        knocksPipeline(
          {
            organizationId,
            campaignId: { $in: zoneIds },
            timestamp: zonedDayRange(windowFrom, todayStr, tz),
          },
          { byCampaign: true, includeRestricted: true }
        )
      );
      const recent = new Map(rows.map((r) => [String(r._id), r]));

      for (const c of zoneCampaigns) {
        const key = String(c._id);
        const row = recent.get(key);
        const recentDoors = row ? billableDoorsOf(row, policyOf.get(key)) : 0;

        // The window is the trailing 14 days, CLIPPED to when this campaign started canvassing,
        // so a young campaign divides its doors by the days it has actually had.
        const startedAt = firstActivated.get(key);
        let windowDays = 0;
        if (startedAt) {
          const startedDay = zonedDayStr(startedAt, tz);
          const windowStart = startedDay > windowFrom ? startedDay : windowFrom;
          windowDays = Math.min(
            PACE_WINDOW_DAYS,
            Math.max(0, daysBetween(windowStart, todayStr) + 1)
          );
        }

        const { deadline, deadlineSource } = deadlineFor(c);
        blocks.set(
          key,
          computeGoalPace({
            target: c.doorGoal,
            done: done.get(key) || 0,
            deadline,
            deadlineSource,
            todayStr,
            recentDoors,
            windowDays,
          })
        );
      }
    })
  );

  return blocks;
}

// Convenience for the single-campaign callers (the client-report builder).
export async function goalProgressForCampaign({ organizationId, campaign, orgDefaults, now }) {
  if (!(Number(campaign?.doorGoal) > 0)) return null;
  const map = await goalProgressFor({
    organizationId: organizationId || campaign.organizationId,
    campaigns: [campaign],
    orgDefaults,
    now,
  });
  return map.get(String(campaign._id)) || null;
}
