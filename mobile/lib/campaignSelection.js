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
