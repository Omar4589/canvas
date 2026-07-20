import NextStepBanner from './NextStepBanner.jsx';
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
// One component used by both the list and the detail page, so the copy can't drift between them.

// Mirrors END_GRACE_DAYS in server/src/services/billing/billingMonths.js. Duplicated because there
// is no shared client/server module in this repo; if that constant moves, this must move with it
// (both call sites are named in docs/BILLING.md).
const END_GRACE_DAYS = 3;

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

// `campaigns` — one or more stale campaigns. `onArchive(campaign)` archives a single one where the
// caller owns that mutation (the Campaigns list). Callers that don't get a link to the page that
// does, rather than a button whose label promises something it won't do. The aggregate form never
// offers the action: "archive 4 campaigns" is not a thing to do from a banner.
export default function ArchiveNudge({ campaigns, onArchive, className = 'mb-4' }) {
  const stale = (campaigns || []).filter(isStale);
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

  return (
    <NextStepBanner
      tone={grace ? 'warning' : 'info'}
      title={
        stale.length === 1
          ? `Election day was ${formatDateLabel(first.electionDay)}.`
          : `${stale.length} campaigns are past their election day.`
      }
      action={action}
      className={className}
    >
      {stale.length > 1 && <span className="font-medium">{names}. </span>}
      {/* The honest primary advice is "archive before the month ends". The 3-day window is a
          forgiveness grace with a condition attached — it only helps if nobody knocked that month —
          so it is never stated as a plan you can rely on. */}
      {grace ? (
        <>
          Archiving stops the billing. Do it in the next few days and this month is free too, as long
          as nobody’s been out yet.
        </>
      ) : (
        <>Archiving stops the billing — otherwise it keeps running next month, knocks or not.</>
      )}
    </NextStepBanner>
  );
}
