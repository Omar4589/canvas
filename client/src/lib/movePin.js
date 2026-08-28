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
];

// Toast after a save. `moved` is the server's count of doors it moved (res.moved).
export const movePinToast = (scope, moved) => {
  if (scope !== 'building') return 'Pin moved.';
  const n = Number(moved) || 0;
  return `Building pin moved · ${n.toLocaleString()} ${pluralize(n, 'unit')}`;
};
