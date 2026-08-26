/**
 * The composite key that pairs a CanvassActivity row with the SurveyResponse rows it produced.
 *
 * The two ledgers share no foreign key. A `survey_submitted` activity row carries a `voterId`,
 * but the mobile submit path deletes every prior replaceable row for {userId, householdId, passId}
 * before creating the new one (routes/mobile/canvass.js), so that field names only the LAST voter
 * surveyed at the door — while the door may hold several responses. Joining on it silently drops
 * the others. Joining on householdId ALONE is worse: it reaches a second canvasser's honest row at
 * the same address, which is exactly what convertChunkFromSurvey's triple scope exists to prevent.
 *
 * So the unit is the TRIPLE — one canvasser's visit to one door in one round — and this is the one
 * place its string form lives.
 *
 * Both `?? 'null'` guards are load-bearing, for the same reason and to different degrees:
 *   • passId — a real null is the legacy pre-turf bucket. Interpolating it bare renders as the
 *     empty string, so `a||b` (a null pass) would collide with a genuine two-part key.
 *   • userId — behaviourally identical today, since a field knock always has a canvasser. Kept
 *     symmetrical so the same collision can never appear if that ever stops being true.
 */
export const doorKey = (r) => `${r.householdId}|${r.passId ?? 'null'}|${r.userId ?? 'null'}`;
