// The rules behind the admin CampaignChip's selection, kept out of the component so they can be
// tested (mobile has no component-test harness — see restrictBooks.js for the same split).
//
// The bug these encode: the chip used to filter /admin/campaigns to ACTIVE campaigns for all
// three of its jobs — what the menu lists, what the auto-default picks, and what counts as a
// valid selection. Only the middle one wants active-only. Because validity was active-only too,
// an org whose campaigns had all finished offered nothing to pick and every campaign-scoped
// admin screen was stuck on its empty state, with a super admin who had just drilled into that
// org unable to read a single note. Archived campaigns are now selectable; the DEFAULT stays
// active-only, so nobody is ever silently seated in finished work.
//
// Everything here reads `isActive === false`, never `!isActive` — a row from an older server
// that omits the field must read as active, not flip a live org read-only.

export const isArchivedCampaign = (c) => c?.isActive === false;

// The persisted active-campaign blob. One writer for the shape that was copy-pasted at eight
// call sites; `canvass.activeCampaign` is read by the canvasser flow too, so it stays exactly
// these five keys.
export const campaignShape = (c) => ({
  id: String(c._id),
  name: c.name,
  type: c.type,
  state: c.state,
  timeZone: c.timeZone,
});

// 'active' | 'archived' | 'unknown'. 'unknown' covers every case a caller must not act on: no
// id, the list still loading, or an id the viewer's list doesn't contain (a lead's scope, or a
// campaign deleted under a stale cache).
export const archiveStateOf = (campaigns, campaignId) => {
  if (!campaignId || !Array.isArray(campaigns)) return 'unknown';
  const found = campaigns.find((c) => String(c._id) === String(campaignId));
  if (!found) return 'unknown';
  return isArchivedCampaign(found) ? 'archived' : 'active';
};

// What the chip should do with the current selection once the list has loaded:
//   undefined → keep it (it is a real campaign in this viewer's list, archived or not)
//   an object → replace it with this (the first ACTIVE campaign)
//   null      → clear it (nothing active to fall back to)
//
// Validating against the FULL list is the fix. Validating against the active-only list is what
// stomped an archived pick — including the one the campaign page's own Notes tile had just
// saved, which is why that tile appeared to do nothing on a finished campaign.
export const resolveChipSelection = ({ value, campaigns }) => {
  if (!Array.isArray(campaigns)) return undefined; // still loading — the caller must not act
  const valid = value && campaigns.some((c) => String(c._id) === String(value.id));
  if (valid) return undefined;
  const firstActive = campaigns.find((c) => !isArchivedCampaign(c));
  return firstActive ? campaignShape(firstActive) : null;
};

// A team lead's ONE active campaign, or null — the phone's half of the home-campaign rule
// (docs/PROPOSAL_LEAD_CAMPAIGN_LANDING.md §B). `campaigns` is the lead's /admin/campaigns list,
// which is already their grants in this org with mid-delete rows split out; counting the rows that
// aren't archived gives exactly the server's homeCampaignId (server/src/routes/auth.js), and
// test/leadHomeCampaign.int.test.js pins the two together. null for anything that isn't a list
// (still loading).
export const soleActiveCampaign = (campaigns) => {
  if (!Array.isArray(campaigns)) return null;
  const live = campaigns.filter((c) => !isArchivedCampaign(c));
  return live.length === 1 ? live[0] : null;
};

// What the admin Overview tab shows: null (not decided yet — show a spinner, never the org totals
// first), 'org' (the org Overview, as always), or 'sole:<id>' (a team lead's one campaign, embedded).
//
//   role         useConsoleRole(): undefined until read, then 'lead' | 'admin' | 'super'
//   campaigns    the lead's /admin/campaigns list (campaignsQ.data?.campaigns), or undefined
//   listLoading  campaignsQ.isLoading — true only while there is no data at all
//
// The role test is the rule, never the query's `enabled`: a disabled query still hands back whatever
// is cached under its key, and admins fill ['admin','campaigns'] from other screens — an admin with
// one campaign must never get the lead's embedded home. With data present, decide from it whatever
// the error flags say (one dropped refetch must not flip the screen away and back); with no data,
// wait while it loads and fall back to the org Overview if it failed.
export const overviewChoice = ({ role, campaigns, listLoading }) => {
  if (!role) return null;
  if (role !== 'lead') return 'org';
  if (Array.isArray(campaigns)) {
    const sole = soleActiveCampaign(campaigns);
    return sole ? `sole:${sole._id}` : 'org';
  }
  return listLoading ? null : 'org';
};
