import { VoterNote } from '../../models/VoterNote.js';

// The ONE writer for admin voter notes — the typed notes on a voter's profile. Three routes add
// one: the org directory (routes/admin/voters.js POST /:voterId/notes), the campaign directory
// (routes/admin/campaignVoters.js) and the mobile profile (routes/mobile/voters.js). Each used to
// inline the same VoterNote.create; one owner keeps the stored shape identical whichever surface
// wrote it. Org-level on purpose (models/VoterNote.js): the note is about the person and follows
// them across campaigns, so it carries no campaignId — the profile unions notes across sibling rows
// for admins and narrows to the opened row for leads (voterProfile.js, scopeCampaignId).
//
// The route still owns everything before the write: which voters the caller may annotate (org
// membership, the campaign grant, a canvasser's books) and the body check
// (z.string().trim().min(1).max(5000) → 400 'Note body required'). This only writes.
// Returns the created VoterNote document.
export async function createVoterNote({ orgId, voterId, authorId, body }) {
  return VoterNote.create({ organizationId: orgId, voterId, authorId, body });
}
