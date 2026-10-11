import { inStateBounds } from '../../utils/stateBounds.js';
import { buildingKeyForCoords } from '../../utils/buildingKey.js';
import { haversineMeters } from '../../utils/normalizeAddress.js';
import { COHORT_DEFAULTS, isCohortOutlier } from '../../utils/pinCohorts.js';
import { GEOCODE_MIN_ACCURACY, PIN_INTERP_MIN_ACCURACY } from '../import/geocode/geocodeFloors.js';

// Which address-lookup answers may move a door, and when several homes' answers make them a complex.
// Pure. It fails closed: an answer that can't prove itself leaves the door where it is, flagged, for a
// person in Pin Fixes. Release 1 (docs/PROPOSAL_PLACEHOLDER_PINS.md §E step 6) placed exact rooftops
// only; the pin-fixes build (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S1.3) puts every answer on ONE
// ladder — an answer may replace a pin only when it beats what the home has — and recognises a condo
// complex instead of refusing it.

// The only answer types that claim a point. Kept for the collapse pool's predicate below.
export const CLAIM_TYPES = new Set(['rooftop', 'point']);

const zip5 = (z) => String(z ?? '').trim().slice(0, 5);
const normCity = (c) => String(c ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// The ZIP and city of Geocodio's matched address ("…, Pahrump, NV 89061" → "89061", "Pahrump").
export const zipOfMatched = (s) => (/(\d{5})(?:-\d{4})?$/.exec(String(s || '').trim()) || [])[1] || null;
export const cityOfMatched = (s) =>
  (/,\s*([^,]+?),\s*[A-Za-z]{2}\s+\d{5}(?:-\d{4})?$/.exec(String(s || '').trim()) || [])[1] || null;

// Is this answer a claim to its point, for this door's address? A claim type, matched in the address's
// own ZIP5, inside the address's state. (Release 1's gate; still the definition of "a claim to the point".)
export const isPointClaim = (answer, door) =>
  !!answer &&
  CLAIM_TYPES.has(answer.accuracyType) &&
  !!answer.matchedZip &&
  answer.matchedZip === zip5(door?.zipCode) &&
  inStateBounds(door?.state, answer.lat, answer.lng);

export const answerKey = (a) => buildingKeyForCoords([a.lng, a.lat]);

// ── The ladder ─────────────────────────────────────────────────────────────────────────────────
// An answer's class: 'exact' (Geocodio knows this house), 'estimate' (the right block, position
// interpolated), 'street' (only the street, or the roof of a NEARBY address), 'none' (a city, county or
// state centroid — never a placement).
export const ANSWER_CLASS = Object.freeze({
  rooftop: 'exact',
  point: 'exact',
  range_interpolation: 'estimate',
  street_center: 'street',
  nearest_rooftop_match: 'street',
});
export const answerClass = (a) => ANSWER_CLASS[a?.accuracyType] || 'none';

// A door's class: what its current pin is worth. 0 — no usable coordinate (parked at a holding spot, or
// a refused file coordinate such as 0,0: `off` is the caller's fileCoordRefusal on the door's own pin);
// 1 — far from its street; 2 — on a shared spot (a complex member is on one too); 3 — an ordinary pin.
export const pinClass = ({ pinSuspect, coordSource, off } = {}) => {
  if (pinSuspect === 'unlocated' || coordSource === 'holding' || off) return 0;
  if (pinSuspect === 'far') return 1;
  if (pinSuspect === 'placeholder' || pinSuspect === 'stray' || pinSuspect === 'complex') return 2;
  return 3;
};

// The answer's ZIP is the address's, or — a ZIP line running down a road — the answer is in the same
// city and, when the street has a cohort, not an outlier against it. One rule, every caller.
export const zipMatches = (answer, door, cohort = null) => {
  if (!answer?.matchedZip) return false;
  if (answer.matchedZip === zip5(door?.zipCode)) return true;
  const mc = normCity(answer.matchedCity);
  if (!mc || mc !== normCity(door?.city)) return false;
  return !cohort || !isCohortOutlier({ lat: answer.lat, lng: answer.lng }, cohort);
};

const outsideStreet = (answer, cohort) => !!cohort && isCohortOutlier({ lat: answer.lat, lng: answer.lng }, cohort);

// The class part of the ladder, once ZIP and state have passed. Returns null when the answer beats the
// door's pin, else the refusal reason.
const ladderRefusal = (cls, pc, answer, cohort, minAccuracy) => {
  const accuracy = answer.accuracy ?? 1;
  if (cls === 'exact') return pc <= 2 ? null : 'does not beat the current pin';
  if (cls === 'estimate') {
    if (pc === 0) return accuracy >= GEOCODE_MIN_ACCURACY() ? null : 'does not beat the current pin';
    if (pc <= 2) {
      if (accuracy < minAccuracy) return 'does not beat the current pin';
      return outsideStreet(answer, cohort) ? 'an estimate outside its street' : null;
    }
    return 'does not beat the current pin';
  }
  if (cls === 'street') {
    if (pc === 0) return null;
    if (pc === 1) return outsideStreet(answer, cohort) ? 'an estimate outside its street' : null;
    return 'does not beat the current pin';
  }
  return `a ${answer.accuracyType || 'typeless'} answer`;
};

/**
 * May this answer replace this door's pin? `door` carries pinClass, zipCode, state, city.
 * `cohort` is the door's street (or ZIP) cohort summary from utils/pinCohorts.js, or null.
 */
export const answerBeats = (answer, door, { cohort = null, minAccuracy = PIN_INTERP_MIN_ACCURACY() } = {}) => {
  if (!answer || !zipMatches(answer, door, cohort)) return false;
  if (!inStateBounds(door?.state, answer.lat, answer.lng)) return false;
  return ladderRefusal(answerClass(answer), door.pinClass ?? 2, answer, cohort, minAccuracy) === null;
};

/**
 * The placement pass's gate.
 *
 *   cands      [{ id, key, base, fam?, zipCode, state, city?, pinClass?, loc?, distrusted }] — looked-up
 *              doors: current ~1.1 m key, street address (fam: its baseFamily), address fields, current
 *              [lng, lat], and their pinDistrustedKeys
 *   answers    Map<id, { lat, lng, accuracyType, accuracy?, matchedZip, matchedCity?, cacheKey }>
 *   doorsOnKey (key) => [{ id, base, fam?, placed, candidate, complex? }] — the ACTIVE doors on a key
 *   cohortFor  (cand) => the cand's cohort summary, or null (optional)
 *
 * Steps, in order:
 *   1. Class every answer: ZIP/city and state first, then — for a far door — the in-place check (an exact
 *      answer, or an estimate at the 0.5 floor, within 250 m of the pin confirms it where it is), then the
 *      ladder. A refused answer is no claim and never counts against anyone.
 *   2. Complexes, BEFORE the distrusted-key test: exact answers from one vendor spot landing on one point
 *      for two or more different addresses are a complex (the vendor and Geocodio agree these homes are
 *      one place); an exact answer landing on a key that already holds a complex joins it. A complex member
 *      ignores a distrusted key equal to its own point — that distrust is the release-1 gate's record of
 *      refusing the very collapse that defines the complex.
 *   3. Everyone else: a distrusted key refuses its door (but still counts against others); a different
 *      address claiming the same point, or any door already on it that isn't this address — a complex door,
 *      a home the lookup placed there (reverted), or a vouched or unflagged home — refuses it.
 *
 * Returns { place: [{ id, key, inPlace, near? }], complex: [{ id, key, spotKey, moveTo }],
 *           refused: Map<id, reason>, distrust: Map<id, Set<key>>, revert: Map<id, key> }
 */
export const lookupPolicy = ({ cands, answers, doorsOnKey, cohortFor = null }) => {
  const place = [];
  const complex = [];
  const refused = new Map();
  const distrust = new Map();
  const revert = new Map();
  const addDistrust = (id, key) => {
    const s = distrust.get(id) || new Set();
    s.add(key);
    distrust.set(id, s);
  };
  const minAccuracy = PIN_INTERP_MIN_ACCURACY();

  // 1. Class.
  const judged = [];
  const claimsByKey = new Map();
  for (const raw of cands) {
    const a = answers.get(raw.id);
    if (!a) continue;
    const c = { ...raw, fam: raw.fam ?? raw.base, pinClass: raw.pinClass ?? 2, loc: raw.loc ?? null, city: raw.city ?? null };
    const cohort = cohortFor ? cohortFor(c) : null;
    const cls = answerClass(a);
    if (cls === 'none') {
      refused.set(c.id, `a ${a.accuracyType || 'typeless'} answer`);
      continue;
    }
    if (!zipMatches(a, c, cohort) || !inStateBounds(c.state, a.lat, a.lng)) {
      refused.set(c.id, 'matched outside its ZIP or state');
      continue;
    }
    const key = answerKey(a);
    if (!key) {
      refused.set(c.id, 'no usable point');
      continue;
    }
    const near =
      c.pinClass === 1 &&
      Array.isArray(c.loc) &&
      (cls === 'exact' || (cls === 'estimate' && (a.accuracy ?? 1) >= GEOCODE_MIN_ACCURACY())) &&
      haversineMeters(c.loc[1], c.loc[0], a.lat, a.lng) <= COHORT_DEFAULTS.minMeters;
    if (!near) {
      const why = ladderRefusal(cls, c.pinClass, a, cohort, minAccuracy);
      if (why) {
        refused.set(c.id, why);
        continue;
      }
    }
    const entry = { c, a, key, cls, near };
    judged.push(entry);
    const list = claimsByKey.get(key) || [];
    list.push({ id: c.id, fam: c.fam, cacheKey: a.cacheKey || null });
    claimsByKey.set(key, list);
  }

  // 2. Complexes.
  const complexIds = new Set();
  const groups = new Map(); // `${vendor spot}|${answer key}` → entries with exact answers
  for (const e of judged) {
    if (e.cls !== 'exact') continue;
    const g = `${e.c.key}|${e.key}`;
    const list = groups.get(g) || [];
    list.push(e);
    groups.set(g, list);
  }
  const sameAddress = (x, y) => x.c.fam === y.c.fam || (!!x.a.cacheKey && x.a.cacheKey === y.a.cacheKey);
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    // Distinct addresses by the sameAddress rule (one street address, or one cache entry: two spellings
    // of one address are one address). A union-find over the group.
    const parent = list.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) if (sameAddress(list[i], list[j])) parent[find(i)] = find(j);
    }
    if (new Set(list.map((_, i) => find(i))).size < 2) continue;
    for (const e of list) complexIds.add(e.c.id);
  }
  for (const e of judged) {
    if (e.cls !== 'exact' || complexIds.has(e.c.id)) continue;
    if ((doorsOnKey(e.key) || []).some((d) => d.complex && d.id !== e.c.id)) complexIds.add(e.c.id); // joins
  }

  // 3. Everyone.
  for (const e of judged) {
    const { c, a, key } = e;
    if (complexIds.has(c.id)) {
      complex.push({ id: c.id, key, spotKey: c.key, moveTo: key !== c.key });
      continue;
    }
    if ((c.distrusted || []).includes(key)) {
      refused.set(c.id, 'a point already distrusted for this home');
      continue;
    }
    let collides = false;
    for (const o of claimsByKey.get(key) || []) {
      if (o.id !== c.id && o.fam !== c.fam && !(a.cacheKey && o.cacheKey === a.cacheKey)) collides = true;
    }
    for (const d of doorsOnKey(key) || []) {
      if (d.id === c.id || (d.fam ?? d.base) === c.fam) continue;
      if (d.complex) {
        // Tested before the placed rule: a complex member the lookup moved is also "placed", and a claimant
        // must never revert it. The claimant is refused; the complex is untouched.
        collides = true;
        continue;
      }
      if (d.placed) {
        collides = true;
        revert.set(d.id, key);
        addDistrust(d.id, key);
        continue;
      }
      if (key === c.key && d.candidate) continue;
      collides = true;
    }
    if (collides) {
      refused.set(c.id, 'another address claims this point');
      addDistrust(c.id, key);
      continue;
    }
    place.push({ id: c.id, key, inPlace: key === c.key || e.near, ...(e.near ? { near: true } : {}) });
  }
  return { place, complex, refused, distrust, revert };
};

// Release 1's name. Its callers and tests pass the old shapes; lookupPolicy defaults the new fields
// (pinClass 2, fam = base, loc null, accuracy 1).
export const stackPolicy = (args) => lookupPolicy(args);
