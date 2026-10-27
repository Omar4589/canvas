import { recomputeFullyVoted } from '../voted/recomputeFullyVoted.js';
import { recomputeFullyDnc } from '../dnc/recomputeFullyDnc.js';
import { recomputeHouseholdActive } from '../import/recomputeHouseholdActive.js';

// Every door flag that depends on WHO LIVES THERE, recomputed together for the given doors of one campaign:
//   fullyVoted — everyone at the door voted early   (services/voted/recomputeFullyVoted.js)
//   fullyDnc   — everyone asked not to be contacted (services/dnc/recomputeFullyDnc.js)
//   isActive   — anyone lives there at all          (services/import/recomputeHouseholdActive.js)
// Call it after any write that adds a person to a door, removes one, or moves one between doors. The three
// used to be hand-paired at each site, and the walk-up add, the walk-up delete and import undo recomputed some
// but not all (docs/EARLY_VOTING.md §F): a person added at a door that had just dropped left it hidden, an
// all-voted door stayed up after its last un-voted resident was deleted, and an undo that left a door holding
// only a do-not-contact resident kept sending canvassers there. The import worker keeps its own sequence
// (services/import/importProcessor.js): it first re-applies the remembered voted and do-not-contact lists and
// sweeps every door they currently suppress.
//
// Safe on a door that no longer exists (each recompute finds nothing to write). fullyVoted and fullyDnc always
// bump updatedAt (their unconditional $set), which is how the door reaches teammates' phones on the 30 s
// /changes poll — dropped, or, when it came back, as a reason to pull a fresh bootstrap.
export const recomputeResidentFlags = async (campaignId, householdIds) => {
  const ids = [...new Set((householdIds || []).map(String))].filter(Boolean);
  if (!ids.length) return;
  await recomputeFullyVoted(campaignId, ids);
  await recomputeFullyDnc(ids);
  await recomputeHouseholdActive(campaignId, ids);
};
