// ⓘ copy for the Control Room's numbers, shared web/mobile (mobile/lib/platformStatsMeta.js
// is the byte-parallel mirror — keep them in sync) so the two apps can never explain a
// counter differently. Semantics verified against server/src/services/platform/platformStats.js
// and routes/superAdmin/platform.js — if those change, this copy changes in the same PR.

export const PLATFORM_TOTALS = [
  {
    key: 'organizations',
    label: 'Organizations',
    help:
      'Every customer organization, ever — those live today plus a banked count of the ones since deleted (an org’s contribution is captured the instant before deletion, so this number never goes down). Active and deactivated orgs both count. Doorline’s own internal/demo orgs are excluded.',
  },
  {
    key: 'campaigns',
    label: 'Campaigns',
    help:
      'Every campaign ever created by a customer org — live rows plus the banked contribution of deleted orgs and campaigns. Archived and finished campaigns count; internal/demo orgs don’t.',
  },
  {
    key: 'doorsKnocked',
    label: 'Doors knocked',
    help:
      'Raw field records: every not-home, wrong-address, refused, survey, and lit-drop a canvasser logged, one per record (admin bulk marks excluded). This is a DIFFERENT unit from the billing and report “knocks”, which count a household once per round — so this number reads higher than billing, on purpose: it’s lifetime field effort, not billable coverage. Deleted orgs’ records stay banked in.',
  },
  {
    key: 'surveyResponses',
    label: 'Surveys',
    help:
      'Survey forms on file — one per voter per round. Resubmitting replaces the old form (no double count), and re-dispositioning a door away from “surveyed” removes its forms. Plus the banked forms of deleted orgs.',
  },
  {
    key: 'votersProcessed',
    label: 'Voters',
    help:
      'Distinct voter records — voters are matched by state voter ID within an org, so re-importing the same file adds nothing. Plus the banked voters of deleted orgs.',
  },
];

// The Control Room's operational overview cards (GET /super-admin/platform-overview).
export const OVERVIEW_HELP = {
  orgs:
    'Every organization on the platform — active and deactivated — INCLUDING Doorline’s own internal/demo orgs. An operational count, not the lifetime total below (which excludes internal orgs and remembers deleted ones).',
  users:
    'Every user account on the platform, whatever orgs they belong to. “Active” is the account flag, not recent activity; “super” counts super admins.',
  activeNow:
    'Distinct canvassers who logged a door action in the past 15 minutes on an active campaign. Admin bulk marks don’t count. Includes the demo org — it lights up after “Refresh demo day”.',
  today:
    'Door actions since midnight UTC (not your local midnight), on active campaigns across all orgs: not-home, wrong address, refused, surveys, lit drops. Includes admin bulk marks; “restricted” doors are tallied separately, never as knocks.',
  campaigns:
    'Every campaign across every organization — archived ones included in the total, with the currently-active count alongside. Same population as the Orgs card (internal/demo orgs included), so the two can be read together.',
};

export const TOTALS_INTRO =
  'Lifetime numbers across all customers. Excludes internal/demo orgs, and survives customer deletion (a deleted org’s contribution is preserved, not lost).';

export const IDLE_ORGS_HELP =
  'An org appears here when all four hold: it’s active; its subscription is a paying status (active, trial, past_due — or no record at all, which fails open to active); it has zero live campaigns, so with per-campaign billing it pays $0; and its newest canvass — or its creation date if it never canvassed — is older than the idle window. These orgs escape BOTH retention sweeps forever: the 60-day wind-down only starts once a subscription is set to canceled, and the dormancy purge never touches a paying status. With no live campaign they can’t knock a door to reset the clock, so nothing automatic will ever resolve them. A human decides: re-engage, or open the org’s Billing panel and set the status to canceled (a reason is required) — that starts the 60-day wind-down, and the nightly retention sweep deletes the org when it lapses.';

// Mobile-only suffix — the actions live on the web console.
export const IDLE_ORGS_MOBILE_NOTE =
  'Re-engage or terminate from the web console: Organizations → Manage billing.';

// The trend sparklines' population, appended to each lifetime card's ⓘ. Built per metric because
// the honest caveat includes the EXACT counts the line can never show: the deleted-org bank (their
// rows were destroyed on deletion, so they have no dates) and any surviving rows without a date.
// One bar per UTC day, through yesterday — the last COMPLETE day — so a partial today never reads
// as a dip.
export function trendCaveat({ deletedCount = 0, undatedCount = 0 } = {}) {
  let s =
    ' The trend line shows live organizations only — one bar per UTC day, through yesterday (the last complete day).';
  if (deletedCount > 0) {
    s += ` ${deletedCount.toLocaleString()} of the lifetime total came from since-deleted customers; their records were destroyed on deletion, so they have no dates and never appear on the line.`;
  }
  if (undatedCount > 0) {
    s += ` ${undatedCount.toLocaleString()} surviving record(s) carry no date and are likewise not on the line.`;
  }
  return s;
}
