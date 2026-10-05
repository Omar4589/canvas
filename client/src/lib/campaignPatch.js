// What the campaign Edit drawer may send for its viewer. Of the drawer's fields a team lead owns a
// campaign's name, survey, timezone and door goal. routes/admin/campaigns.js 403s each field on its
// admin-only list (isActive, type, state, the key dates, the dates note, the invoice policy, the opt-in
// outcomes) when a lead sends it, even sent back unchanged, so the drawer, which shows those read-only
// to a lead, must not send them. (A lead may also set disabledOutcomes and doorAddPolicy, on App
// Customization; neither is a drawer field.) Org admins send the whole form, as before.
export const LEAD_CAMPAIGN_FIELDS = ['name', 'surveyTemplateId', 'timeZone', 'doorGoal', 'goalDate'];

export const campaignPatchFor = (body, { isOrgAdmin }) =>
  isOrgAdmin
    ? body
    : Object.fromEntries(LEAD_CAMPAIGN_FIELDS.filter((k) => k in body).map((k) => [k, body[k]]));
