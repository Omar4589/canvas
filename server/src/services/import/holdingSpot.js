import { Household } from '../../models/Household.js';
import { buildingKeyForCoords } from '../../utils/buildingKey.js';
import { fileCoordRefusal } from '../../utils/stateBounds.js';
import { zipEligible } from './geocode/geocodeService.js';

// The holding spot: where a home goes when the file gave no usable coordinate (none, 0,0, outside its
// state) and the address lookup found nothing — instead of being dropped with its voters, or left in the
// ocean (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S5.2). It is ONE point per ZIP per campaign, the middle
// of that ZIP's other homes, deliberately NOT the home: every home parked there is written with
// coordSource 'holding' and pinSuspect 'unlocated', so every map draws the spot as "N homes", Pin Fixes
// lists them under "Couldn't be found by address", the cut's toggle leaves them out, and a lead can place
// each one (Place along the street) or set it aside. Never vouchable: confirmHouseholdLocation refuses.
//
// The spot for a ZIP, in order: the spot this campaign already parks that ZIP's homes at (so every import
// reuses one); the mean of this file's placed homes in the ZIP; the mean of this file's placed homes in the
// same city; the mean of the campaign's doors in the ZIP; else none (the caller drops the home, as before).
// A new spot is nudged north (~55 m a step) until no door sits within 1.5 m of it, so a holding spot never
// lands on a real house or a vendor's shared spot. Two imports of one campaign running at once can each
// derive a spot for the same ZIP — harmless: a parked home keeps whichever it got.

const NUDGE_DEG = 0.0005;
const NUDGE_TRIES = 20;
const RADIUS_M = 1.5;
const EARTH_M = 6378137;
const CAMPAIGN_SAMPLE = 2000;

const zip5 = (z) => String(z ?? '').trim().slice(0, 5);
const cityKey = (h) => `${String(h.state ?? '').trim().toUpperCase()}|${String(h.city ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
const meanOf = (pts) => ({
  lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
  lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
});

export const createHoldingSpots = async ({ campaignId, householdMap }) => {
  // The spots this campaign already parks homes at, one read per run (the pinSuspect partial index).
  const existing = new Map();
  const parked = await Household.find(
    { campaignId, isActive: true, pinSuspect: { $type: 'string', $eq: 'unlocated' }, coordSource: 'holding' },
    { location: 1, zipCode: 1 }
  ).lean();
  for (const d of parked) {
    const z = zip5(d.zipCode);
    const c = d.location?.coordinates;
    if (z && c?.length === 2 && !existing.has(z)) existing.set(z, { lng: c[0], lat: c[1] });
  }

  // This file's placed homes, by ZIP and by city (a refused coordinate is already null here).
  const byZip = new Map();
  const byCity = new Map();
  const fileKeys = new Set();
  for (const h of householdMap.values()) {
    if (h.latitude == null || h.longitude == null || h.coordSource === 'holding') continue;
    const p = { lat: h.latitude, lng: h.longitude };
    const z = zip5(h.zipCode);
    if (z) (byZip.get(z) || byZip.set(z, []).get(z)).push(p);
    const ck = cityKey(h);
    (byCity.get(ck) || byCity.set(ck, []).get(ck)).push(p);
    const k = buildingKeyForCoords([h.longitude, h.latitude]);
    if (k) fileKeys.add(k);
  }

  const campaignMean = async (z) => {
    const docs = await Household.find(
      { campaignId, isActive: true, location: { $ne: null }, zipCode: new RegExp(`^${z}`) },
      { location: 1, state: 1 }
    ).limit(CAMPAIGN_SAMPLE).lean();
    const pts = [];
    for (const d of docs) {
      const c = d.location?.coordinates;
      if (c?.length === 2 && !fileCoordRefusal({ lat: c[1], lng: c[0], state: d.state })) pts.push({ lat: c[1], lng: c[0] });
    }
    return pts.length ? meanOf(pts) : null;
  };

  const nudge = async (spot) => {
    let p = { ...spot };
    for (let i = 0; i < NUDGE_TRIES; i += 1) {
      const taken =
        fileKeys.has(buildingKeyForCoords([p.lng, p.lat])) ||
        !!(await Household.exists({
          campaignId,
          isActive: true,
          location: { $geoWithin: { $centerSphere: [[p.lng, p.lat], RADIUS_M / EARTH_M] } },
        }));
      if (!taken) return p;
      p = { lat: p.lat + NUDGE_DEG, lng: p.lng };
    }
    return p;
  };

  const memo = new Map();
  const spotFor = async (h) => {
    if (!zipEligible(h)) return null;
    const z = zip5(h.zipCode);
    if (memo.has(z)) return memo.get(z);
    let spot = existing.get(z) || null;
    if (!spot) {
      const file = byZip.get(z);
      const city = byCity.get(cityKey(h));
      const fresh = file?.length ? meanOf(file) : city?.length ? meanOf(city) : await campaignMean(z);
      spot = fresh ? await nudge(fresh) : null;
    }
    memo.set(z, spot);
    return spot;
  };

  return {
    // Park one household object (from the import's householdMap). Returns false when no spot could be
    // derived — the caller then drops the home, exactly as an unplaceable home was dropped before.
    assign: async (h) => {
      const spot = await spotFor(h);
      if (!spot) return false;
      h.latitude = spot.lat;
      h.longitude = spot.lng;
      h.coordSource = 'holding';
      h.coordConfidence = null;
      return true;
    },
  };
};
