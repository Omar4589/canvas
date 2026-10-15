// Campaign time zones come from the server, which only accepts eight curated US zones on write
// (server/src/routes/admin/campaigns.js) — but a legacy record could still carry a name Intl doesn't
// know, and Intl THROWS on an unknown timeZone ("Incorrect timeZone information provided" in Hermes).
// Inside a tap handler or a timer that used to take the whole app down. Each name is checked once; an
// unknown one falls back to the phone's own zone (its IANA name, so the zone label still prints).
// Same idea as lib/electionDates.js's todayInTz. docs/PROPOSAL_ERROR_RECOVERY.md §B7.
const verdicts = new Map();

const deviceZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

// Empty input comes back as-is: each caller keeps its own no-zone behavior.
export const safeTimeZone = (tz) => {
  if (!tz) return tz;
  let known = verdicts.get(tz);
  if (known === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      known = true;
    } catch {
      known = false;
      console.warn(`Unknown time zone "${tz}" — showing times in the phone's own zone instead.`);
    }
    verdicts.set(tz, known);
  }
  return known ? tz : deviceZone();
};

export const _resetTimeZoneCache = () => {
  verdicts.clear();
};
