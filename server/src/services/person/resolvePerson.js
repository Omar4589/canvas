import mongoose from 'mongoose';
import { Person } from '../../models/Person.js';
import { PersonMergeCandidate } from '../../models/PersonMergeCandidate.js';
import { normalizePersonKeys } from './normalizePersonKeys.js';

// The single source of matching truth, shared by the importer and the backfill.
// Matching priority: namespaced (uidSource, uid) first, then (registeredState,
// stateVoterId). Never auto-merges across the uid/svid boundary; never cross-links
// keyless rows. resolvePerson NEVER mutates an existing Person's identity — that is
// propagation's job; it only seeds identity on create and appends keys (promotion).
//
// ── EVERY LOOKUP AND EVERY CREATE IN THIS FILE IS ORG-SCOPED. ───────────────────────────────
// It did not used to be. A Person was global, so matching a voter's state ID here could return
// a Person another CUSTOMER had created — silently linking two customers' voter rows to one
// record, after which propagateIdentity fanned one customer's edits into the other's database.
// `orgId` is now required on every entry point, and it is the first term of every query and
// every insert. Dedup still does its job — it just cannot reach across a customer boundary.
// See models/Person.js for why this matters (processor vs controller).

const IDENTITY_FIELDS = [
  'firstName', 'lastName', 'phone', 'phoneType', 'cellPhone',
  'party', 'gender', 'dateOfBirth', 'registrationStatus',
];

function identityDoc(identity = {}) {
  const out = {};
  for (const f of IDENTITY_FIELDS) if (identity[f] !== undefined) out[f] = identity[f];
  out.fullName =
    identity.fullName || [identity.firstName, identity.lastName].filter(Boolean).join(' ') || null;
  return out;
}

const uidEntry = (k, source) => ({ uidSource: k.uidSource, uid: k.uid, source, at: new Date() });
const svidEntry = (k, source) => ({
  registeredState: k.registeredState, stateVoterId: k.stateVoterId, source, at: new Date(),
});

const sameId = (a, b) => !!(a && b && String(a._id) === String(b._id));
const sess = (session) => session || null;

export async function followMerged(person, session) {
  let p = person;
  let guard = 0;
  while (p && p.mergedInto && guard++ < 25) {
    p = await Person.findById(p.mergedInto).session(sess(session));
  }
  return p;
}

// `orgId` is stamped on the candidate so the review endpoint can filter/page in the DB. Both sides
// of a pair are provably same-org (every matcher query above/below is org-prefixed), so one org id
// describes the whole candidate.
async function raiseCandidate(orgId, aId, bId, reason, k, session) {
  let A = aId;
  let B = bId ?? null;
  if (B && String(A) > String(B)) { const t = A; A = B; B = t; }
  await PersonMergeCandidate.updateOne(
    { personIdA: A, personIdB: B, reason },
    {
      $setOnInsert: {
        organizationId: orgId, personIdA: A, personIdB: B, reason, status: 'open',
        sampleUid: k.uid ?? null, sampleSvid: k.stateVoterId ?? null, sampleState: k.registeredState ?? null,
      },
    },
    { upsert: true, session: session || undefined }
  );
}

async function refindByKeys({ uidKeys = [], svidKeys = [] }, orgId, session) {
  if (uidKeys.length) {
    const e = uidKeys[0];
    const p = await Person.findOne(
      { organizationId: orgId, uidKeys: { $elemMatch: { uidSource: e.uidSource, uid: e.uid } }, mergedInto: null }
    ).session(sess(session));
    if (p) return p;
  }
  if (svidKeys.length) {
    const e = svidKeys[0];
    const p = await Person.findOne(
      { organizationId: orgId, svidKeys: { $elemMatch: { registeredState: e.registeredState, stateVoterId: e.stateVoterId } }, mergedInto: null }
    ).session(sess(session));
    if (p) return p;
  }
  return null;
}

async function createPerson({ uidKeys = [], svidKeys = [] }, identity, { matchConfidence, orgId, session }) {
  const doc = { organizationId: orgId, uidKeys, svidKeys, matchConfidence: matchConfidence || null, ...identityDoc(identity) };
  try {
    const arr = await Person.create([doc], { session: session || undefined });
    return arr[0];
  } catch (err) {
    // A concurrent worker won the unique key — re-find the survivor it created. The unique index
    // is now (organizationId, key), so "the survivor" can only ever be one of THIS org's.
    if (err && err.code === 11000) {
      const found = await refindByKeys({ uidKeys, svidKeys }, orgId, session);
      if (found) return found;
    }
    throw err;
  }
}

// Append a key to a matched Person (cross-state mover / late-arriving uid). If the
// key already belongs to a DIFFERENT person the unique index throws — that is a
// genuine uid/svid disagreement, so we flag a candidate instead of merging.
async function promote(person, field, entry, present, k, session) {
  if (person[field].some(present)) return;
  try {
    await Person.updateOne({ _id: person._id }, { $push: { [field]: entry } }, { session: session || undefined });
    person[field].push(entry);
  } catch (err) {
    if (err && err.code === 11000) {
      // The conflicting Person can only be in the same org (the unique index is org-prefixed), so
      // this stays a within-org identity disagreement for a human to resolve — never a cross-customer one.
      const q = field === 'uidKeys'
        ? { organizationId: person.organizationId, uidKeys: { $elemMatch: { uidSource: k.uidSource, uid: k.uid } }, mergedInto: null }
        : { organizationId: person.organizationId, svidKeys: { $elemMatch: { registeredState: k.registeredState, stateVoterId: k.stateVoterId } }, mergedInto: null };
      const other = await Person.findOne(q).session(sess(session));
      if (other && !sameId(other, person)) {
        // NOTE: no `orgId` variable exists in promote()'s scope — person.organizationId is the org
        // (and provably `other`'s too: the lookup above filters on it).
        await raiseCandidate(person.organizationId, person._id, other._id, 'uid_svid_conflict', k, session);
      }
    } else throw err;
  }
}

/**
 * Resolve one row's keys to a canonical Person (find or create).
 * @returns {{ person: Person, matched: boolean }}
 */
export async function resolvePerson(rawKeys, identity = {}, opts = {}) {
  const { source = 'import', session = null, orgId = null } = opts;
  // Fail loud. A missing orgId here used to be harmless (Persons were global); now it would
  // create an org-less Person that matches nobody and violates the required field — better to
  // stop at the call site than to write a broken row.
  if (!orgId) throw new Error('resolvePerson: orgId is required (Persons are org-scoped)');

  const k = normalizePersonKeys(rawKeys);
  const hasUid = !!(k.uidSource && k.uid);
  const hasSvid = !!(k.registeredState && k.stateVoterId);

  // No usable key → isolated Person + review flag; never cross-link.
  if (!hasUid && !hasSvid) {
    const person = await createPerson({}, identity, { matchConfidence: null, orgId, session });
    await raiseCandidate(orgId, person._id, null, k.stateVoterId ? 'state_missing' : 'keyless', k, session);
    return { person, matched: false };
  }

  const byUid = hasUid
    ? await Person.findOne(
        { organizationId: orgId, uidKeys: { $elemMatch: { uidSource: k.uidSource, uid: k.uid } }, mergedInto: null }
      ).session(sess(session))
    : null;
  const bySvid = hasSvid
    ? await Person.findOne(
        { organizationId: orgId, svidKeys: { $elemMatch: { registeredState: k.registeredState, stateVoterId: k.stateVoterId } }, mergedInto: null }
      ).session(sess(session))
    : null;

  if (hasUid && hasSvid) {
    if (byUid && bySvid) {
      if (sameId(byUid, bySvid)) return { person: byUid, matched: true };
      // uid and svid point at different humans → review, never auto-merge.
      await raiseCandidate(orgId, byUid._id, bySvid._id, 'uid_svid_conflict', k, session);
      return { person: byUid, matched: true }; // link to the uid match (authoritative)
    }
    if (byUid) {
      await promote(byUid, 'svidKeys', svidEntry(k, source),
        (x) => x.registeredState === k.registeredState && x.stateVoterId === k.stateVoterId, k, session);
      return { person: byUid, matched: true };
    }
    if (bySvid) {
      await promote(bySvid, 'uidKeys', uidEntry(k, source),
        (x) => x.uidSource === k.uidSource && x.uid === k.uid, k, session);
      return { person: bySvid, matched: true };
    }
    const person = await createPerson(
      { uidKeys: [uidEntry(k, source)], svidKeys: [svidEntry(k, source)] },
      identity, { matchConfidence: 'exact_uid', orgId, session }
    );
    return { person, matched: false };
  }

  if (hasUid) {
    if (byUid) return { person: byUid, matched: true };
    const person = await createPerson({ uidKeys: [uidEntry(k, source)] }, identity, { matchConfidence: 'exact_uid', orgId, session });
    return { person, matched: false };
  }

  // svid only
  if (bySvid) return { person: bySvid, matched: true };
  const person = await createPerson({ svidKeys: [svidEntry(k, source)] }, identity, { matchConfidence: 'fallback_svid', orgId, session });
  return { person, matched: false };
}

// Rows carrying BOTH keys may trigger promotion/conflict, so they always resolve
// fresh; single-key rows can share a cached result within the batch.
function cacheKeyOf(k) {
  const hasUid = !!(k.uidSource && k.uid);
  const hasSvid = !!(k.registeredState && k.stateVoterId);
  if (hasUid && hasSvid) return null;
  if (hasUid) return `u:${k.uidSource} ${k.uid}`;
  if (hasSvid) return `s:${k.registeredState} ${k.stateVoterId}`;
  return null;
}

/**
 * Resolve many rows to canonical Persons, batched. Preloads every existing Person matching
 * one of the batch's keys (a few chunked $in queries), then matches in memory. The clean
 * cases — an unambiguous existing match, or a brand-new create with no promotion — stay in
 * memory: creates are deferred to a single bulk insert and indexed immediately so later
 * same-key rows share them. The rare complex paths (a partial uid/svid match that promotes,
 * a uid/svid conflict, or a keyless row) flush the pending creates and defer to the proven
 * per-row resolvePerson, so its E11000-retry + conflict-candidate behavior is preserved
 * exactly. A state voter file (svid-only, no vendor uid) hits only the clean paths → fully
 * bulk; vendor files fall back per-row only on the genuinely ambiguous rows.
 *
 * @param rows [{ rowKey, keys:{uidSource,uid,registeredState,stateVoterId}, identity }]
 * @returns Map<rowKey, personId>
 */
export async function resolvePersonsBatch(rows, opts = {}) {
  const { source = 'import', session = null, orgId = null } = opts;
  if (!orgId) throw new Error('resolvePersonsBatch: orgId is required (Persons are org-scoped)');
  const out = new Map();
  if (!rows.length) return out;

  // 1. Preload existing Persons by the batch's keys; index each by ALL its keys (so a row
  //    matches by uid or svid). Grouped by uidSource/registeredState so each $in is over a
  //    single namespace; chunked.
  const normRows = rows.map((r) => ({ rowKey: r.rowKey, keys: r.keys, identity: r.identity, k: normalizePersonKeys(r.keys) }));
  const uidBySource = new Map();
  const svidByState = new Map();
  for (const { k } of normRows) {
    if (k.uidSource && k.uid) {
      if (!uidBySource.has(k.uidSource)) uidBySource.set(k.uidSource, new Set());
      uidBySource.get(k.uidSource).add(k.uid);
    }
    if (k.registeredState && k.stateVoterId) {
      if (!svidByState.has(k.registeredState)) svidByState.set(k.registeredState, new Set());
      svidByState.get(k.registeredState).add(k.stateVoterId);
    }
  }
  const uidMap = new Map();
  const svidMap = new Map();
  const indexPerson = (p) => {
    for (const u of p.uidKeys || []) uidMap.set(`${u.uidSource} ${u.uid}`, p);
    for (const s of p.svidKeys || []) svidMap.set(`${s.registeredState} ${s.stateVoterId}`, p);
  };
  // organizationId on both preloads is what stops the importer matching a voter to a Person that
  // belongs to a DIFFERENT customer — the exact link that made one identity graph out of many
  // customers' voter files.
  for (const [src, set] of uidBySource) {
    const arr = [...set];
    for (let i = 0; i < arr.length; i += 5000) {
      const docs = await Person.find({ organizationId: orgId, uidKeys: { $elemMatch: { uidSource: src, uid: { $in: arr.slice(i, i + 5000) } } }, mergedInto: null }, { uidKeys: 1, svidKeys: 1 }).lean().session(sess(session));
      for (const d of docs) indexPerson(d);
    }
  }
  for (const [state, set] of svidByState) {
    const arr = [...set];
    for (let i = 0; i < arr.length; i += 5000) {
      const docs = await Person.find({ organizationId: orgId, svidKeys: { $elemMatch: { registeredState: state, stateVoterId: { $in: arr.slice(i, i + 5000) } } }, mergedInto: null }, { uidKeys: 1, svidKeys: 1 }).lean().session(sess(session));
      for (const d of docs) indexPerson(d);
    }
  }

  // 2. Match in memory; defer clean creates to a bulk insert.
  const newDocs = [];
  const makeNew = (keyDoc, identity) => {
    const _id = new mongoose.Types.ObjectId();
    const doc = { _id, organizationId: orgId, uidKeys: keyDoc.uidKeys || [], svidKeys: keyDoc.svidKeys || [], matchConfidence: keyDoc.matchConfidence || null, ...identityDoc(identity) };
    newDocs.push(doc);
    indexPerson(doc); // so later same-key rows share this just-made Person
    return _id;
  };
  const flushNew = async () => {
    if (!newDocs.length) return;
    const batch = newDocs.splice(0, newDocs.length);
    for (let i = 0; i < batch.length; i += 1000) {
      const chunk = batch.slice(i, i + 1000);
      try {
        await Person.insertMany(chunk, { ordered: false, session: session || undefined });
      } catch (err) {
        // A concurrent worker created a same-key Person (E11000). ordered:false inserted the
        // rest; re-find each survivor and remap any rows that pointed at our failed _id.
        const writeErrors = err?.writeErrors || (err?.code === 11000 ? [{ index: 0 }] : null);
        if (!writeErrors) throw err;
        for (const we of writeErrors) {
          const failed = chunk[we.index];
          if (!failed) continue;
          const survivor = await refindByKeys({ uidKeys: failed.uidKeys, svidKeys: failed.svidKeys }, orgId, session);
          if (survivor) {
            const fid = String(failed._id);
            for (const [rk, id] of out) if (String(id) === fid) out.set(rk, survivor._id);
          }
        }
      }
    }
  };

  for (const { rowKey, keys, identity, k } of normRows) {
    if (newDocs.length >= 5000) await flushNew(); // keep the pending-insert buffer bounded
    const hasUid = !!(k.uidSource && k.uid);
    const hasSvid = !!(k.registeredState && k.stateVoterId);
    const byUid = hasUid ? uidMap.get(`${k.uidSource} ${k.uid}`) : null;
    const bySvid = hasSvid ? svidMap.get(`${k.registeredState} ${k.stateVoterId}`) : null;

    if (hasUid && hasSvid) {
      if (byUid && bySvid && sameId(byUid, bySvid)) { out.set(rowKey, byUid._id); continue; }
      if (!byUid && !bySvid) {
        out.set(rowKey, makeNew({ uidKeys: [uidEntry(k, source)], svidKeys: [svidEntry(k, source)], matchConfidence: 'exact_uid' }, identity));
        continue;
      }
      // partial match (promotion) or conflicting match → complex, fall through
    } else if (hasUid) {
      if (byUid) { out.set(rowKey, byUid._id); continue; }
      out.set(rowKey, makeNew({ uidKeys: [uidEntry(k, source)], matchConfidence: 'exact_uid' }, identity));
      continue;
    } else if (hasSvid) {
      if (bySvid) { out.set(rowKey, bySvid._id); continue; }
      out.set(rowKey, makeNew({ svidKeys: [svidEntry(k, source)], matchConfidence: 'fallback_svid' }, identity));
      continue;
    }

    // Complex (promotion / uid-svid conflict / keyless): flush pending creates so the proven
    // per-row resolver sees them, defer to it, then reflect its result in the maps.
    await flushNew();
    const { person } = await resolvePerson(keys, identity, opts);
    indexPerson(person);
    out.set(rowKey, person._id);
  }
  await flushNew();
  return out;
}
