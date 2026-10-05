// Move pin — the copy, the error wording and the cache contract the web shares between the Map
// page panel and the Turf Cutting pop-ups (house = one door, building = every unit on the pin).
// Both pages drive the same PATCH /admin/campaigns/:id/households/:hid/location through
// useMovePin.js; this module is the pure half so `node --test src/` pins it (movePin.test.js).
// No React, no api, no mapbox here — keep it that way.

import { pluralize } from './mapCounts.js';

// What the card says. `body` is segments rather than one string so the card can wrap the
// address in <strong> without re-spelling the sentence; join the `text`s to read it plain.
//   scope  — 'unit' (one door) | 'building' (every unit at the pin, the server's fan-out)
//   count  — units moving together (building only)
export const movePinCopy = ({ scope, count, addressLine1 } = {}) => {
  const building = scope === 'building';
  const address = addressLine1 || (building ? 'this building' : 'this door');
  const n = Number(count) || 0;
  return {
    title: building ? 'Move building pin' : 'Move pin',
    body: [
      { text: 'Drag the blue marker to ' },
      { text: address, strong: true },
      {
        text: building
          ? `'s correct spot, then Save — this moves all ${n} ${pluralize(n, 'unit')} together.`
          : "'s correct spot, then Save.",
      },
    ],
    caveat: building
      ? 'Corrects the pins only — these doors keep their current book until you re-cut turf (the book outline redraws around them). Canvassers see the new spot on their next sync.'
      : 'Corrects the pin only — this door keeps its current book until you re-cut turf (the book outline redraws around it). Canvassers see the new spot on their next sync.',
    saveLabel: 'Save location',
  };
};

// Inline error under the card. `api()` throws with `.status` / `.code` / `.data`
// (api/client.js); the server's own sentence wins where it is the precise one ("That spot is
// outside NE.") and a generic fallback covers the rest.
export const movePinErrorMessage = (err) => {
  const code = err?.code || err?.data?.code || null;
  if (code === 'out_of_bounds') return err.message || 'That spot is outside the campaign state.';
  if (code === 'invalid_coords') return 'That spot is not a valid location — drag the marker onto the map and try again.';
  if (code === 'campaign-archived' || err?.status === 409) return 'This campaign is archived — pins are read-only.';
  if (code === 'FORBIDDEN_ROLE' || err?.status === 403) return 'Only campaign admins and team leads can move pins.';
  if (err?.status === 404) return 'This door is no longer in the campaign.';
  return err?.message || 'Could not move the pin.';
};

// Every query a moved pin can stale, by PREFIX — the cross-page contract. A pin move redraws
// the affected book outlines server-side (Turf.boundary), so the turfs list refreshes too, not
// only the dots. Callers also run invalidateFlagCaches(qc) (bulkReview.js): a far-from-house
// flag is re-assessed live against the new coordinate. Deliberately NOT here: turf-progress and
// household-activity — a pin move is not a knock.
export const movePinInvalidationKeys = (campaignId) => [
  ['turf-doors', campaignId], // Turf Cutting dots
  ['turfs', campaignId], // re-hulled boundaries
  ['turf-household', campaignId], // the Turf pop-up's drill (location / provenance)
  ['admin', 'households-map', campaignId], // Map page dots + panel
  ['admin', 'packet-data', campaignId], // print packets with geo
  ['admin', 'pin-fixes', campaignId], // Pin Fixes queue — a moved pin leaves the needs-fixing set
  ['admin', 'campaigns'], // sidebar Pin Fixes badge (pinsToFix rides the campaigns rollup)
  ['apartment-preview', campaignId], // Turf Cutting's Remove apartments line counts doors per map spot
];

// The server's answer when a save moved nothing (res.moved === 0): still on an unplaced home's own
// pin, or back onto the shared spot a placed home left. The card stays open and the page doesn't
// advance (useMovePin.js).
export const NOTHING_MOVED = 'Nothing moved — drag the pin onto the house';

// A save closer than this to a home's own pin moved nothing. On a home without an exact map spot
// (pinSuspect), Save stays off until the drag clears it: mapbox starts a marker drag only past its
// 3 px click tolerance, ~1.45 m at zoom 17, so a nudge would otherwise enable Save and no-op.
export const NO_MOVE_METERS = 1.5;
const toRad = (d) => (d * Math.PI) / 180;
export const metersBetween = (a, b) => {
  if (!a || !b) return Infinity;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
};
// May this drag be saved? Always for a door with an exact spot (nudging an approximate pin is the
// common case); for a home without one, only once it is clearly off the spot.
export const canSaveMove = (target, coords) =>
  !!target && !!coords && (!target.unplaced || metersBetween(target, coords) > NO_MOVE_METERS);

// Toast after a save. `moved` is the server's count of doors it moved (res.moved).
export const movePinToast = (scope, moved) => {
  if (Number(moved) === 0) return NOTHING_MOVED;
  if (scope !== 'building') return 'Pin moved.';
  const n = Number(moved) || 0;
  return `Building pin moved · ${n.toLocaleString()} ${pluralize(n, 'unit')}`;
};
