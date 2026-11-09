import { useQuery } from '@tanstack/react-query';
import NextStepBanner from './NextStepBanner.jsx';
import { api, getActiveOrgId } from '../api/client.js';
import { daysUntil, formatDateLabel } from '../lib/electionDates.js';
import { todayInTz } from '../lib/datePresets.js';

// "Election day has passed — archive this campaign?"
//
// A campaign bills EVERY month until it's archived, whether or not anyone knocks. That rule is
// right (a live campaign holds its turf, its data and its people), but it bites hardest on exactly
// the campaigns this business is made of: a two-week GOTV push that ends on election night and
// then sits there, quietly billing into the next year because nobody clicked Archive.
//
// So the moment a campaign's own election day passes, say so. Archiving is reversible and deletes
// nothing, which is what makes this a safe thing to prompt.
//
// TWO KINDS OF CAMPAIGN (billing rules v4, docs/PROPOSAL_BILLING_CYCLES.md §F). One first out before
// the switch day bills by calendar month and keeps the wording below unchanged; one first out on or
// after it renews monthly on the date of its first visit. Which is which, and the renewal dates,
// come from GET /admin/billing-renewals: the rule for every org admin, the dates only for admins
// with billing access (owner decision 9). So the dated wording keys on whether the answer HAS dates,
// never on the viewer's billing access, which a browser only learns at sign-in.
//
// One component used by both the list and the detail page, so the copy can't drift between them.

// Mirrors END_GRACE_DAYS in server/src/services/billing/billingMonths.js. Duplicated because there
// is no shared client/server module in this repo; if that constant moves, this must move with it
// (both call sites are named in docs/BILLING.md).
const END_GRACE_DAYS = 3;

// The renewals route's cap (MAX_RENEWAL_IDS in server/src/routes/admin/billingRenewals.js). Past
// it, the reminder says only what is true of every campaign.
const MAX_ASK = 50;

// Is today inside the end-grace window — the first N days of a month, when archiving a campaign
// that hasn't knocked still makes this month free?
function inEndGrace(tz) {
  return Number(todayInTz(tz).slice(8, 10)) <= END_GRACE_DAYS;
}

// Has this campaign's election day passed while the campaign is still live?
export function isStale(c) {
  if (!c?.isActive) return false;
  if (c.electionDay == null) return false; // never leave this to `null < 0` being falsy
  const d = daysUntil(c.electionDay, c.timeZone);
  return d != null && d < 0;
}

const idOf = (c) => String(c?._id ?? c?.id ?? '');

// The calendar-month wording, unchanged since before monthly renewals. The honest primary advice is
// "archive before the month ends". The 3-day window is a forgiveness grace with a condition
// attached — it only helps if nobody knocked that month — so it is never stated as a plan you can
// rely on.
const calendarCopy = (grace) =>
  grace ? (
    <>
      Archiving stops the billing. Do it in the next few days and this month is free too, as long as
      nobody’s been out yet.
    </>
  ) : (
    <>Archiving stops the billing — otherwise it keeps running next month, knocks or not.</>
  );

// `campaigns` — one or more stale campaigns. `onArchive(campaign)` archives a single one where the
// caller owns that mutation (the Campaigns list). Callers that don't get a link to the page that
// does, rather than a button whose label promises something it won't do. The aggregate form never
// offers the action: "archive 4 campaigns" is not a thing to do from a banner.
const ArchiveNudge = ({ campaigns, onArchive, className = 'mb-4' }) => {
  const stale = (campaigns || []).filter(isStale);
  // `hasCanvassed: false` (from /admin/campaigns) means no activity at all, so never out, and is
  // worded at once. Every other stale campaign is asked about: activity can still be desk work
  // only, and only the server knows which rules a campaign bills under. Sorted so the query key
  // doesn't change with the list's order.
  const ids = stale
    .filter((c) => c.hasCanvassed !== false)
    .map(idOf)
    .sort();
  const tooMany = ids.length > MAX_ASK;
  const orgId = getActiveOrgId();
  const rulesQ = useQuery({
    queryKey: ['admin', 'billing-renewals', orgId, ids.join(',')],
    queryFn: ({ signal }) => api(`/admin/billing-renewals?ids=${ids.join(',')}`, { signal }),
    enabled: ids.length > 0 && !tooMany,
    // The dates are the server's "today" when fetched; coming back to a tab left open overnight asks
    // again (the app turns this off globally). The render below never trusts stale dates meanwhile.
    refetchOnWindowFocus: true,
  });

  if (!stale.length) return null;

  const first = stale[0];
  const grace = inEndGrace(first.timeZone);
  const names =
    stale.length === 1
      ? first.name
      : `${stale.slice(0, 3).map((c) => c.name).join(', ')}${stale.length > 3 ? ` and ${stale.length - 3} more` : ''}`;

  const action =
    stale.length === 1 && onArchive
      ? { label: 'Archive campaign', onClick: () => onArchive(first) }
      : { label: 'Go to Campaigns', to: '/campaigns' };

  const rows = new Map((rulesQ.data?.campaigns || []).map((r) => [String(r.campaignId), r]));
  const asking = ids.length > 0 && !tooMany;
  const loading = asking && rulesQ.isPending;
  // A failed request with no earlier answer, too many to ask about, or a campaign the answer left out
  // (deleted meanwhile): say only what is true of every campaign rather than guess its rule. A failed
  // background refetch keeps the last good answer, whose dates are re-checked against today below.
  const unknown =
    tooMany ||
    (asking && ((rulesQ.isError && !rulesQ.data) || (rulesQ.data && ids.some((id) => !rows.has(id)))));
  // null = never out; 'calendar' | 'cycle' otherwise.
  const ruleOf = (c) => (c.hasCanvassed === false ? null : rows.get(idOf(c))?.billingRule ?? null);

  let tone = 'info';
  let body = null; // while the rules load, the title alone
  if (loading) {
    body = null;
  } else if (unknown) {
    body = <>Archiving stops any billing.</>;
  } else if (stale.length === 1) {
    const rule = ruleOf(first);
    const row = rows.get(idOf(first));
    // Re-check the answer's dates against today on the campaign's calendar, as reminderDates() would
    // now: a page left open overnight must not keep promising a window that has closed.
    const today = todayInTz(first.timeZone);
    const inWindow = Boolean(row?.lastRenewalDay && row?.graceUntilDay && row.lastRenewalDay <= today && today <= row.graceUntilDay);
    const nextAhead = Boolean(row?.nextRenewalDay && today < row.nextRenewalDay);
    if (!rule) {
      body = <>It hasn’t been out, so it isn’t billing. Archive it when you’re done.</>;
    } else if (rule === 'calendar') {
      tone = grace ? 'warning' : 'info';
      body = calendarCopy(grace);
    } else if (inWindow) {
      // Inside a renewal's 3 days — never the first renewal, which always bills (the server leaves
      // lastRenewalDay null for it).
      tone = 'warning';
      body = (
        <>
          It renewed on {formatDateLabel(row.lastRenewalDay)}. Archive by {formatDateLabel(row.graceUntilDay)} and, if
          nobody’s been out since, that renewal is free.
        </>
      );
    } else if (nextAhead) {
      body = <>Archive before {formatDateLabel(row.nextRenewalDay)} and it won’t renew.</>;
    } else {
      // Monthly renewals, no dates: an admin without billing access (or dates that went stale).
      body = <>Archiving stops the billing — otherwise it renews every month, knocks or not.</>;
    }
  } else {
    // Several campaigns: never a date.
    const outRules = stale.map(ruleOf).filter(Boolean);
    if (!outRules.length) {
      body = <>None of these has been out, so none is billing. Archive them when you’re done.</>;
    } else if (outRules.every((r) => r === 'calendar')) {
      tone = grace ? 'warning' : 'info';
      body = calendarCopy(grace);
    } else {
      body = (
        <>Archiving stops the billing — otherwise the ones that have been out keep billing every month, knocks or not.</>
      );
    }
  }

  return (
    <NextStepBanner
      tone={tone}
      title={
        stale.length === 1
          ? `Election day was ${formatDateLabel(first.electionDay)}.`
          : `${stale.length} campaigns are past their election day.`
      }
      action={action}
      className={className}
    >
      {stale.length > 1 && <span className="font-medium">{names}. </span>}
      {body}
    </NextStepBanner>
  );
};

export default ArchiveNudge;
