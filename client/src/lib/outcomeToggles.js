// Hand mirror of server/src/services/canvass/outcomeToggles.js — which door outcomes a campaign
// may turn off (Campaign.disabledOutcomes) vs. the ones that are never optional. Kept identical
// to the server and to mobile/lib/outcomeToggles.js by server/test/outcomeToggles.test.js, the
// same gate actionLabels uses for the label maps. Plain ESM, no React imports, so node can load
// it in that test.
//
// OUTCOME_HINTS is the settings screens' one-line "how does this count?" copy — it describes the
// reporting semantics (docs/METRICS.md) so an admin knows what turning one off does NOT change:
// history keeps counting everywhere.
export const TOGGLEABLE_OUTCOMES = Object.freeze(['restricted', 'refused', 'wrong_address', 'no_soliciting']);
export const ALWAYS_ON_OUTCOMES = Object.freeze(['not_home', 'survey_submitted', 'lit_dropped']);

export const OUTCOME_HINTS = Object.freeze({
  refused: 'Counts as a knock and a contact — someone answered and declined.',
  wrong_address: 'Counts as a knock; flags a bad address.',
  no_soliciting: 'Counts as a knock, not a contact — a posted sign ended the visit.',
  restricted: "Not a knock — the home couldn't be reached. Can count as a billable door.",
});
