// The one definition of which door outcomes a campaign may turn OFF, which ones it may turn ON, and
// which are wired into the product too deeply to ever be optional. Three disjoint classes:
//
//   TOGGLEABLE_OUTCOMES — on by default. Campaign.disabledOutcomes stores the subset a campaign
//     turned off (a DENY-list: empty/missing = everything on); the mobile door screen hides a
//     disabled outcome's button, and routes/mobile/canvass.js refuses fresh submissions of one with
//     OUTCOME_DISABLED (offline replays recorded before the toggle flipped are still accepted).
//   OPT_IN_OUTCOMES — OFF by default (docs/PROPOSAL_NOT_TARGET_OUTCOME.md). Campaign.enabledOutcomes
//     stores the subset a campaign turned ON (an ALLOW-list: empty/missing = off), set only by the
//     org-admin, audited campaign PATCH. They are also survey-only, and they exist at all only once
//     Doorline releases them (availableOptInOutcomes below). They cannot live in the deny-list: every
//     stored [] would read as ON, and a lost update would fail open.
//   ALWAYS_ON_OUTCOMES — not_home is the door list's one-tap quick action, and survey_submitted /
//     lit_dropped are each campaign type's completion action; turn those off and canvassing has no
//     point.
//
// Hand-mirrored on both clients (client/src/lib/outcomeToggles.js, mobile/lib/outcomeToggles.js)
// for their settings screens, gated by test/outcomeToggles.test.js the same way actionLabels keeps
// the label maps honest. This is a RECORDING policy only: nothing in reports/aggregations.js reads
// it — historical rows of a disabled or withdrawn outcome keep counting on every surface.
export const TOGGLEABLE_OUTCOMES = Object.freeze(['restricted', 'refused', 'wrong_address', 'no_soliciting']);
export const OPT_IN_OUTCOMES = Object.freeze(['not_target']);
export const ALWAYS_ON_OUTCOMES = Object.freeze(['not_home', 'survey_submitted', 'lit_dropped']);

// Which opt-in outcomes Doorline has RELEASED — the OPT_IN_OUTCOMES config var, comma-separated,
// read at call time so a change in the Heroku dashboard (which restarts the dynos) takes effect with
// no deploy, and so a test can set it per case. Unset = none: no settings screen offers the outcome,
// the campaign PATCH refuses it, and phones get an empty list. Unsetting it after a release is the
// Doorline-wide off switch — every campaign's button goes and fresh taps are refused, while each
// campaign keeps its enabledOutcomes for when it returns. The release waits for the app update:
// an older bundle draws a not_target door as an unknocked house.
export const availableOptInOutcomes = () =>
  (process.env.OPT_IN_OUTCOMES || '')
    .split(',')
    .map((s) => s.trim())
    .filter((k) => OPT_IN_OUTCOMES.includes(k));

// The one answer to "may this outcome be recorded on this campaign right now?". Every reader that
// used to test `disabledOutcomes.includes(k)` goes through this — the recording gate, the Door
// Outcomes desk's targets, the survey conversion's targets — so a default-off outcome can never
// read as on just because no deny-list mentions it.
export const isOutcomeEnabled = (campaign, key, available = availableOptInOutcomes()) => {
  if (OPT_IN_OUTCOMES.includes(key)) {
    return campaign?.type === 'survey' && available.includes(key) && (campaign?.enabledOutcomes || []).includes(key);
  }
  if (TOGGLEABLE_OUTCOMES.includes(key)) return !(campaign?.disabledOutcomes || []).includes(key);
  return true;
};

// Has a phone EVER been able to show this outcome's button for this campaign? Toggleable and
// always-on outcomes: yes. Opt-in: only once it has been on at least once — everEnabledOutcomes,
// which the campaign PATCH maintains, or on right now (so the answer stays right even if
// enabledOutcomes was ever written by something other than the PATCH). Deliberately ignores the
// release: a tap recorded while it was released and on is honored after a withdrawal.
export const outcomeEverEnabled = (campaign, key) =>
  !OPT_IN_OUTCOMES.includes(key) ||
  (campaign?.everEnabledOutcomes || []).includes(key) ||
  (campaign?.enabledOutcomes || []).includes(key);

// "Does this campaign use the outcome?" — the ONE predicate behind every conditional column, tile,
// chip and per-round CSV column. Rows of an opt-in outcome can only exist once it has been on, so a
// customer who never turns it on never sees the words. Never reads the release: history stays
// visible after a withdrawal.
export const outcomeInUse = (campaign, key) => outcomeEverEnabled(campaign, key);

// The opt-in list a phone may act on: the stored setting ∩ released ∩ survey campaign. Shipped on
// the bootstrap and in /mobile/changes' door-config block — a phone never needs the raw setting.
export const effectiveEnabledOutcomes = (campaign, available = availableOptInOutcomes()) =>
  OPT_IN_OUTCOMES.filter((k) => isOutcomeEnabled(campaign, k, available));

// A stable fingerprint of everything that decides which buttons a door screen shows. The bootstrap
// and /mobile/changes compute it with this same function from the same lean document; a phone sends
// its copy on the 30-second poll and gets the new door settings back only when they differ. It
// contains ',' and '|', so the client must always encodeURIComponent it — a raw '|' makes iOS 15/16
// re-encode the whole URL, the server 400s every poll, and the phone silently stops syncing.
export const doorConfigStamp = (campaign, available = availableOptInOutcomes()) =>
  [
    [...(campaign?.disabledOutcomes || [])].sort().join(','),
    effectiveEnabledOutcomes(campaign, available).join(','),
    campaign?.doorAddPolicy || 'all',
  ].join('|');
