import { Voter } from '../../models/Voter.js';
import { canonicalVoterId, voterIdVariants, MAX_VOTER_ID_WIDTH } from '../../utils/voterIdKey.js';

// The ONE way to find voters from IDs that came from OUTSIDE the database — an uploaded list, a
// typed ID, a parked ID. Stored IDs are compared exactly everywhere else, and that is fine for a
// stored value: it already has the spelling the file gave it. An outside ID does not. Georgia writes
// 08719967 and Excel writes 8719967; Nebraska writes 1234567 and the state's own file may write
// 0001234567. So an outside ID is reduced to its canonical form (utils/voterIdKey.js) and looked up
// under every spelling a stored row could carry — the bare number and each zero-padded width up to
// the widest numeric ID the scope actually holds. Symmetric by construction, and it rides the
// existing {campaignId, stateVoterId} / {organizationId, stateVoterId} indexes: no new index, no
// migration. test/voterIdChokePoint.test.js fails the build if a new exact-string lookup of an
// outside ID appears anywhere else.
//
// Scope matters. Inside one campaign (early voting, walk lists, un-mark) the same digits are always
// the same person. Across an organization they are not — two states can issue the same digits — so
// the do-not-contact upload scopes its lookup to one state's campaigns (services/import/
// parseVoterIdList.js) and this helper never widens a scope on its own.

const VARIANT_CHUNK = 5000; // total spellings per $in, not IDs — a 3-digit ID can carry 20 spellings

// The widest all-digit ID stored in the scope: how far a canonical ID must be padded to reach every
// stored spelling. 0 when the scope holds no numeric IDs (letter-bearing states, an empty campaign).
export async function widestNumericIdWidth(scopeFilter) {
  const [row] = await Voter.aggregate([
    { $match: scopeFilter },
    { $project: { s: { $trim: { input: { $ifNull: ['$stateVoterId', ''] } } } } },
    { $match: { s: { $regex: /^[0-9]+$/ } } },
    { $group: { _id: null, width: { $max: { $strLenCP: '$s' } } } },
  ]);
  const width = row?.width || 0;
  if (width > MAX_VOTER_ID_WIDTH) {
    console.warn(`voterIdLookup: widest numeric ID in scope is ${width} characters; padding capped at ${MAX_VOTER_ID_WIDTH}`);
    return MAX_VOTER_ID_WIDTH;
  }
  return width;
}

// Fold a list of outside IDs: trimmed, non-empty, distinct in file order; grouped by canonical ID
// (first spelling first); blank and all-zero values set aside as carrying no ID at all.
export function foldVoterIds(ids) {
  const seen = new Set();
  const raws = [];
  for (const v of ids || []) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    raws.push(s);
  }
  const byCanonical = new Map(); // canonical -> [raw spellings, first first]
  let noId = 0;
  for (const raw of raws) {
    const canonical = canonicalVoterId(raw);
    if (canonical == null) {
      noId += 1;
      continue;
    }
    const list = byCanonical.get(canonical);
    if (list) list.push(raw);
    else byCanonical.set(canonical, [raw]);
  }
  return { raws, byCanonical, noId };
}

/**
 * Find the voters in `scopeFilter` that an outside list of IDs names.
 *
 * Returns:
 *   voters            every matched row (deduped by _id), with `projection` (+ stateVoterId always)
 *   hitsByCanonical   Map canonical -> matched rows
 *   rawsByCanonical   Map canonical -> the file's spellings of it
 *   notFoundIds       the file's own spellings of every ID that matched nothing
 *   matchedViaZeros   distinct file IDs that matched, but under a spelling the file did not carry
 *   zeroMatchExample  one such pair { file, stored }, or null
 *   idsInFile         distinct IDs in the file (two spellings of one ID count once)
 *   spellings         distinct raw values in the file
 *   noId              raw values that carry no ID (blank, all-zero) — never looked up, never parked
 *   widest            the padding width used
 */
export async function findVotersByVoterIds({ scopeFilter, ids, projection = null }) {
  const { raws, byCanonical, noId } = foldVoterIds(ids);
  // No projection = every field. A projection always carries stateVoterId, which the matching needs.
  const proj = projection ? { ...projection, stateVoterId: 1 } : undefined;
  const result = {
    voters: [],
    hitsByCanonical: new Map(),
    rawsByCanonical: byCanonical,
    notFoundIds: [],
    matchedViaZeros: 0,
    zeroMatchExample: null,
    idsInFile: byCanonical.size,
    spellings: raws.length,
    noId,
    widest: 0,
  };
  if (!byCanonical.size) return result;

  // Padding is only worth measuring when some ID is numeric; a letter-only list needs no scan.
  const canonicals = [...byCanonical.keys()];
  const width = canonicals.some((c) => /^[0-9]+$/.test(c)) ? await widestNumericIdWidth(scopeFilter) : 0;
  result.widest = width;

  // Every spelling of every ID, queried in chunks of total spellings.
  const allSpellings = [];
  for (const c of canonicals) for (const s of voterIdVariants(c, width)) allSpellings.push(s);
  const seenIds = new Set();
  for (let i = 0; i < allSpellings.length; i += VARIANT_CHUNK) {
    const docs = await Voter.find({ ...scopeFilter, stateVoterId: { $in: allSpellings.slice(i, i + VARIANT_CHUNK) } }, proj).lean();
    for (const d of docs) {
      const key = String(d._id);
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      result.voters.push(d);
      const c = canonicalVoterId(d.stateVoterId);
      const list = result.hitsByCanonical.get(c);
      if (list) list.push(d);
      else result.hitsByCanonical.set(c, [d]);
    }
  }

  for (const [canonical, fileSpellings] of byCanonical) {
    const hits = result.hitsByCanonical.get(canonical);
    if (!hits) {
      result.notFoundIds.push(...fileSpellings);
      continue;
    }
    const stored = new Set(hits.map((h) => h.stateVoterId));
    if (!fileSpellings.some((s) => stored.has(s))) {
      result.matchedViaZeros += 1;
      if (!result.zeroMatchExample) result.zeroMatchExample = { file: fileSpellings[0], stored: hits[0].stateVoterId };
    }
  }
  return result;
}

// The import-preview / import-worker question: of the file IDs that matched NO stored voter by exact
// string, how many name a voter this campaign already holds under another spelling? Each one would
// be inserted a second time by the exact upsert, so the answer decides whether the import may run.
export async function zeroOnlyMatchesForMisses(campaignId, missedSvids, { examples = 5 } = {}) {
  const lookup = await findVotersByVoterIds({ scopeFilter: { campaignId }, ids: missedSvids, projection: { _id: 1 } });
  const out = { count: 0, examples: [] };
  for (const [canonical, fileSpellings] of lookup.rawsByCanonical) {
    const hits = lookup.hitsByCanonical.get(canonical);
    if (!hits) continue;
    out.count += 1;
    if (out.examples.length < examples) out.examples.push({ file: fileSpellings[0], stored: hits[0].stateVoterId });
  }
  return out;
}

// Delete parked IDs (VotedPendingId / DncPendingId rows) whose canonical ID is in `canonicals`,
// whatever spelling they were parked under. Parked rows are few (one per ID a list could not match)
// and carry only short strings, so folding them in memory is cheaper than any query trick.
export async function clearParkedByCanonical(Model, filter, canonicals) {
  const wanted = canonicals instanceof Set ? canonicals : new Set(canonicals);
  if (!wanted.size) return 0;
  const rows = await Model.find(filter, { stateVoterId: 1 }).lean();
  const ids = rows.filter((r) => wanted.has(canonicalVoterId(r.stateVoterId))).map((r) => r._id);
  for (let i = 0; i < ids.length; i += VARIANT_CHUNK) {
    await Model.deleteMany({ _id: { $in: ids.slice(i, i + VARIANT_CHUNK) } });
  }
  return ids.length;
}
