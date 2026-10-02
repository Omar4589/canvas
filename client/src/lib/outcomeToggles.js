// Hand mirror of server/src/services/canvass/outcomeToggles.js — which door outcomes a campaign
// may turn off (Campaign.disabledOutcomes), which it may turn on (Campaign.enabledOutcomes — the
// opt-in class, off by default), and the ones that are never optional. Kept identical to the server
// and to mobile/lib/outcomeToggles.js by server/test/outcomeToggles.test.js, the same gate
// actionLabels uses for the label maps. Plain ESM, no React imports, so node can load it in that
// test.
//
// OUTCOME_HINTS is the settings screens' one-line "how does this count?" copy — it describes the
// reporting semantics (docs/METRICS.md) so an admin knows what turning one off does NOT change:
// history keeps counting everywhere.
export const TOGGLEABLE_OUTCOMES = Object.freeze(['restricted', 'refused', 'wrong_address', 'no_soliciting']);
export const OPT_IN_OUTCOMES = Object.freeze(['not_target']);
export const ALWAYS_ON_OUTCOMES = Object.freeze(['not_home', 'survey_submitted', 'lit_dropped']);

export const OUTCOME_HINTS = Object.freeze({
  refused: 'Counts as a knock and a contact — someone answered and declined.',
  wrong_address: 'Counts as a knock; flags a bad address.',
  no_soliciting: 'Counts as a knock, not a contact — a posted sign ended the visit.',
  restricted: "Not a knock — the home couldn't be reached. Can count as a billable door.",
  not_target:
    "Someone answered who isn't on the list for that address and wouldn't give their name. Counts as a knock and a contact — never as a survey.",
});

// The server's rule, minus the config var it cannot read: `available` is the released list the
// campaigns response carries (optInOutcomesAvailable). Used where the console must not offer an
// outcome the server would refuse — the Door Outcomes "Change to" list.
export const isOutcomeEnabled = (campaign, key, available = []) => {
  if (OPT_IN_OUTCOMES.includes(key)) {
    return campaign?.type === 'survey' && available.includes(key) && (campaign?.enabledOutcomes || []).includes(key);
  }
  if (TOGGLEABLE_OUTCOMES.includes(key)) return !(campaign?.disabledOutcomes || []).includes(key);
  return true;
};

// "Does this campaign use the outcome?" — the gate behind every column, tile, chip and filter that
// exists only for an opt-in outcome. Reads the FULL campaign document (the /admin/campaigns row);
// never a shaped copy, which would not carry these fields and would read false forever.
export const outcomeInUse = (campaign, key) =>
  !OPT_IN_OUTCOMES.includes(key) ||
  (campaign?.everEnabledOutcomes || []).includes(key) ||
  (campaign?.enabledOutcomes || []).includes(key);
