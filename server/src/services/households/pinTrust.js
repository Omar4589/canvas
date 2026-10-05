import { inStateBounds } from '../../utils/stateBounds.js';
import { buildingKeyForCoords } from '../../utils/buildingKey.js';

// Which address-lookup answers the placement pass may write (services/households/placeStackedPins.js;
// docs/PROPOSAL_PLACEHOLDER_PINS.md §E step 6). Pure. It fails closed: an answer that can't prove
// itself leaves the door on its shared spot, flagged, for a person to fix in Pin Fixes.

// The only answer types that claim a point. A nearest_rooftop_match is Geocodio saying "I couldn't
// find this address — here is the nearest roof I do know": another address's roof. Street-level
// estimates (range_interpolation) wait for a calibration run; this release refuses them.
export const CLAIM_TYPES = new Set(['rooftop', 'point']);

const zip5 = (z) => String(z ?? '').trim().slice(0, 5);

// The ZIP of Geocodio's matched address ("…, Pahrump, NV 89061" → "89061").
export const zipOfMatched = (s) => (/(\d{5})(?:-\d{4})?$/.exec(String(s || '').trim()) || [])[1] || null;

// Is this answer a claim to its point, for this door's address? A claim type, matched in the address's
// own ZIP5 (a missing matched address refuses), and inside the address's state. Cache hits skip the
// geocode service's own bounds check, so it is re-checked here.
export const isPointClaim = (answer, door) =>
  !!answer &&
  CLAIM_TYPES.has(answer.accuracyType) &&
  !!answer.matchedZip &&
  answer.matchedZip === zip5(door?.zipCode) &&
  inStateBounds(door?.state, answer.lat, answer.lng);

export const answerKey = (a) => buildingKeyForCoords([a.lng, a.lat]);

/**
 * The placement pass's gate.
 *
 *   cands      [{ id, key, base, zipCode, state, distrusted }] — looked-up doors: current building key,
 *              stackBaseOf, address ZIP and state, and their pinDistrustedKeys
 *   answers    Map<id, { lat, lng, accuracyType, matchedZip, cacheKey }>
 *   doorsOnKey (key) => [{ id, base, placed, candidate }] — the ACTIVE doors on a key: `placed` =
 *              currently placed by the lookup; `candidate` = flagged, unvouched and looked up
 *
 * An answer is placed only when it is a claim, its key isn't one the door already distrusts, and no
 * DIFFERENT street address claims the same ~1.1 m point. The comparison set is every other claim in
 * this pass, every door the lookup placed on that key earlier, and every other door on that key —
 * except, in the door's own bucket, the flagged candidates, whose own answers are judged here (or
 * meet this door in a later pass, once one of them is placed). An answer refused for its type, ZIP or
 * state is no claim and never counts against anyone; one refused for a distrusted key still does.
 * Answers served by one cache entry are one address. When the other door is one the lookup placed
 * earlier, both are distrusted: that door goes back to the spot it left, and both doors remember the
 * key, so one file and two files end the same way.
 *
 * Returns { place: [{ id, key, inPlace }], refused: Map<id, reason>, distrust: Map<id, Set<key>>,
 *           revert: Map<id, key> }
 */
export const stackPolicy = ({ cands, answers, doorsOnKey }) => {
  const place = [];
  const refused = new Map();
  const distrust = new Map();
  const revert = new Map();
  const addDistrust = (id, key) => {
    const s = distrust.get(id) || new Set();
    s.add(key);
    distrust.set(id, s);
  };

  const judged = [];
  const claimsByKey = new Map();
  for (const c of cands) {
    const a = answers.get(c.id);
    if (!a) continue;
    if (!isPointClaim(a, c)) {
      refused.set(c.id, CLAIM_TYPES.has(a.accuracyType) ? 'matched outside its ZIP or state' : `a ${a.accuracyType || 'typeless'} answer`);
      continue;
    }
    const key = answerKey(a);
    if (!key) {
      refused.set(c.id, 'no usable point');
      continue;
    }
    judged.push({ c, a, key });
    const list = claimsByKey.get(key) || [];
    list.push({ id: c.id, base: c.base, cacheKey: a.cacheKey || null });
    claimsByKey.set(key, list);
  }

  for (const { c, a, key } of judged) {
    if ((c.distrusted || []).includes(key)) {
      refused.set(c.id, 'a point already distrusted for this home');
      continue;
    }
    const sameAddress = (o) => o.base === c.base || (!!a.cacheKey && o.cacheKey === a.cacheKey);
    let collides = false;
    for (const o of claimsByKey.get(key) || []) {
      if (o.id !== c.id && !sameAddress(o)) collides = true;
    }
    for (const d of doorsOnKey(key) || []) {
      if (d.id === c.id || d.base === c.base) continue;
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
    place.push({ id: c.id, key, inPlace: key === c.key });
  }
  return { place, refused, distrust, revert };
};
