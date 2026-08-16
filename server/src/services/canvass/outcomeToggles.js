// The one definition of which door outcomes a campaign may turn OFF, and which are wired into
// the product too deeply to ever be optional. Campaign.disabledOutcomes stores a subset of
// TOGGLEABLE_OUTCOMES (empty/missing = everything on); the mobile door screen hides a disabled
// outcome's button, and routes/mobile/canvass.js refuses fresh submissions of one with
// OUTCOME_DISABLED (offline replays recorded before the toggle flipped are still accepted).
// ALWAYS_ON_OUTCOMES makes the split explicit rather than implied: not_home is the door list's
// one-tap quick action, and survey_submitted / lit_dropped are each campaign type's completion
// action — turn those off and canvassing has no point.
//
// Hand-mirrored on both clients (client/src/lib/outcomeToggles.js, mobile/lib/outcomeToggles.js)
// for their settings screens, gated by test/outcomeToggles.test.js the same way actionLabels
// keeps the label maps honest. This is a RECORDING policy only: nothing in reports/aggregations.js
// reads it — historical rows of a disabled outcome keep counting on every surface.
export const TOGGLEABLE_OUTCOMES = Object.freeze(['restricted', 'refused', 'wrong_address', 'no_soliciting']);
export const ALWAYS_ON_OUTCOMES = Object.freeze(['not_home', 'survey_submitted', 'lit_dropped']);
