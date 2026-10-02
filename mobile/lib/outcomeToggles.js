// Hand mirror of server/src/services/canvass/outcomeToggles.js — which door outcomes a campaign
// may turn off (Campaign.disabledOutcomes), which it may turn on (Campaign.enabledOutcomes — the
// opt-in class, off by default), and the ones that are never optional. Kept identical to the server
// and to client/src/lib/outcomeToggles.js by server/test/outcomeToggles.test.js, the same gate
// actionLabels uses for the label maps. Plain ESM, no React Native imports, so node can load it in
// that test.
//
// OUTCOME_HINTS is the admin settings screen's one-line "how does this count?" copy — it describes
// the reporting semantics (docs/METRICS.md) so an admin knows what turning one off does NOT change:
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

// May the door screen show this outcome's button? Reads the BOOTSTRAP campaign. FAIL-CLOSED for the
// opt-in class: the server ships `enabledOutcomes` already narrowed to what this phone may act on
// (released, survey campaign, turned on), so an older server or a disk-cached bootstrap without the
// field reads OFF — never the deny-list's "unlisted means on". Toggleable keys keep the deny-list
// rule; always-on keys are always on.
export const isOutcomeOn = (campaign, key) => {
  if (OPT_IN_OUTCOMES.includes(key)) {
    return (
      campaign?.type === 'survey' &&
      Array.isArray(campaign?.enabledOutcomes) &&
      campaign.enabledOutcomes.includes(key)
    );
  }
  if (TOGGLEABLE_OUTCOMES.includes(key)) return !(campaign?.disabledOutcomes || []).includes(key);
  return true;
};

// "Does this campaign use the outcome?" — the gate behind every admin figure, chip and tab that
// exists only for an opt-in outcome. Needs the FULL campaign row from the ['admin','campaigns']
// query — screens holding a shaped campaign (campaignShape, useAdminCampaign) go through
// lib/useOutcomeInUse.js instead, because those copies never carry these fields.
export const outcomeInUse = (campaign, key) =>
  !OPT_IN_OUTCOMES.includes(key) ||
  (campaign?.everEnabledOutcomes || []).includes(key) ||
  (campaign?.enabledOutcomes || []).includes(key);
