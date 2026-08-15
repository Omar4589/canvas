import { Organization } from '../../models/Organization.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { knocksPipeline, billableDoorsOf } from './aggregations.js';
import { resolveBillRestricted } from './billRestricted.js';
import { zonedDayStr } from '../../utils/timezone.js';

// Door-goal progress — the ONE owner of this math. Every surface (the campaigns list, the
// campaign rollup that feeds both dashboards, the client report) reads a block from here;
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
//   2. Days are CALENDAR days, and TODAY IS NOT ONE OF THEM (owner ruling 2026-08-14 — no
//      canvass-weekday pattern either). See the divisor comment in computeGoalPace.
//
// WHAT THIS DELIBERATELY NO LONGER DOES (owner ruling 2026-08-15). It used to also report a
// trailing 14-day actual rate, an ahead/on-track/behind verdict and a projected finish date.
// All three were removed from every surface, so computing them here was pure cost: a
// Pass.activatedAt lookup plus one knocksPipeline per distinct campaign timezone on every
// rollup and every campaigns-list load, feeding fields nobody rendered. The goal reports
// progress and what it takes from here; it no longer grades anyone. If a verdict is ever wanted
// back, it is a rebuild, not an uncomment — and it needs the suppression rules that made it
// honest (a floor of canvassing history before judging, and a projection cap) rebuilt with it.

// 'YYYY-MM-DD' civil-date arithmetic, matching client/src/lib/electionDates.js. Anchored at
// UTC Date.UTC deltas so it never touches a real timezone — these are civil dates, and the zone
// they mean is already baked into the strings by the caller.
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
// gets a countdown and a daily target — the explicit goalDate exists for the common case of
// wanting the universe walked BEFORE election day (GOTV), not to make people type it twice.
export function deadlineFor(campaign) {
  if (campaign?.goalDate) return { deadline: campaign.goalDate, deadlineSource: 'goalDate' };
  if (campaign?.electionDay) return { deadline: campaign.electionDay, deadlineSource: 'electionDay' };
  return { deadline: null, deadlineSource: null };
}

// Whole-percent progress. Never rounds UP to 100 while doors remain — a bar reading 100% on an
// unfinished goal is the one lie a progress bar can tell. Exported so the frozen client-report
// snapshot computes it the same way the live surfaces do.
export function goalPercent(done, target) {
  if (!(target > 0)) return 0;
  if (done >= target) return 100;
  return Math.min(99, Math.round((done / target) * 100));
}

// PURE. Everything the clients render, computed from numbers the caller already has.
export function computeGoalPace({ target, done = 0, deadline = null, deadlineSource = null, todayStr }) {
  const remaining = Math.max(0, target - done);
  const percent = goalPercent(done, target);
  const daysLeft = deadline ? daysBetween(todayStr, deadline) : null;

  // TODAY DOES NOT COUNT. The divisor is the whole days remaining AFTER today — the same number
  // the UI shows as "N days left" — not that plus today. By the time anyone reads this, today's
  // canvassing is already planned, underway or done; you cannot re-plan it, so counting it as a
  // fully available day quietly understates what every remaining day has to carry.
  //
  // Clamped at 1 rather than allowed to hit 0: on the deadline day itself there are no days after
  // today, and the only truthful framing left is "all of it, today" — which is what a divisor of 1
  // says. That is not the optimism this rule removes; it is the last day genuinely being the last.
  const daysUsable = daysLeft == null ? null : Math.max(1, daysLeft);
  const requiredPerDay =
    remaining > 0 && daysUsable != null && daysLeft >= 0 ? Math.ceil(remaining / daysUsable) : null;
  // Null inside the last week: "2,713 a week" with three days left is arithmetic nobody can act
  // on, and it reads as a bigger number than the goal itself.
  const requiredPerWeek =
    remaining > 0 && daysUsable != null && daysLeft >= 0 && daysUsable >= 7
      ? Math.ceil(remaining / (daysUsable / 7))
      : null;

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

  const policyOf = new Map(withGoal.map((c) => [String(c._id), resolveBillRestricted(c, org)]));

  // ── Doors done, all-time ────────────────────────────────────────────────────────────────
  // Seeded campaigns read straight off the denormalized counters — no query at all. Legacy docs
  // whose stats were never reconciled (stats.reconciledAt null) fall back to the live pipeline,
  // for those docs only: the counters are exact or unused, never approximate. On a fully seeded
  // org this function now issues ZERO aggregations.
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

  // ── The block ───────────────────────────────────────────────────────────────────────────
  // `todayStr` is resolved per campaign timezone (a rollup can legitimately span zones — the
  // same reason it carries a crossZoneDaySeam warning). Pure Intl formatting, no queries.
  const blocks = new Map();
  for (const c of withGoal) {
    const tz = c.timeZone || 'America/New_York';
    const { deadline, deadlineSource } = deadlineFor(c);
    blocks.set(
      String(c._id),
      computeGoalPace({
        target: c.doorGoal,
        done: done.get(String(c._id)) || 0,
        deadline,
        deadlineSource,
        todayStr: zonedDayStr(now, tz),
      })
    );
  }

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
