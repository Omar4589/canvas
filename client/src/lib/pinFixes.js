// Pin Fixes — the pure half of the queue page (street grouping, the Google Maps link, toast +
// error copy, the cache contract). No React, no api, no mapbox, so `node --test src/` pins it
// (pinFixes.test.js) — the same split movePin.js uses for the move-pin feature.

import { groupHouseholds, buildingLabel } from './buildings.js';
import { streetOf } from './streetName.js';
import { pluralize } from './mapCounts.js';

// Queue rows from the /pin-fixes payload: one row per PIN — doors sharing the ~1.1m building
// key collapse to a single row, because one move or confirm settles every unit on it (the
// server fans scope:'building' out to the same key). Grouped by street (streetOf — house
// number + unit stripped) because that's how the list is worked: one street at a time against
// the imagery. Streets sort A→Z numeric-aware; rows by house number, then label.
//
// Returns { groups: [{ street, rows }], rowCount, rowKeys, idToRowKey } where each row is
//   { rowKey, kind: 'building'|'door', label, sub, lng, lat, target, door, units }
// and `target` is exactly what useMovePin.start() and the confirm POST take. `units` is the
// building's full unit list (null on door rows) — the action popup renders it. idToRowKey maps
// EVERY door id (stacked units included) to its row, for the map's pin-click handler. `rowKeys`
// is the flattened street-sorted order — the ONE order Next/Prev and auto-advance walk, kept
// here (not re-derived in the page) so the tests pin it.
export const buildStreetGroups = (households) => {
  const { buildings, stackedIds } = groupHouseholds(households);
  const rows = [];
  const idToRowKey = new Map();
  for (const b of buildings) {
    const rowKey = `b:${b.key}`;
    rows.push({
      rowKey,
      kind: 'building',
      label: buildingLabel(b),
      sub: `${b.total} ${pluralize(b.total, 'unit')} at one pin`,
      street: streetOf(b.addressLine1),
      houseNumber: parseInt(b.addressLine1, 10) || 0,
      lng: b.lng,
      lat: b.lat,
      target: {
        id: String(b.units[0].id),
        addressLine1: buildingLabel(b),
        lng: b.lng,
        lat: b.lat,
        scope: 'building',
        count: b.total,
      },
      door: b.units[0],
      units: b.units,
    });
    for (const u of b.units) idToRowKey.set(String(u.id), rowKey);
  }
  for (const h of households || []) {
    if (stackedIds.has(h.id)) continue;
    if (h.location?.lng == null || h.location?.lat == null) continue;
    const rowKey = `h:${h.id}`;
    rows.push({
      rowKey,
      kind: 'door',
      label: h.addressLine2 ? `${h.addressLine1} ${h.addressLine2}` : h.addressLine1,
      sub: null,
      street: streetOf(h.addressLine1),
      houseNumber: parseInt(h.addressLine1, 10) || 0,
      lng: h.location.lng,
      lat: h.location.lat,
      target: {
        id: String(h.id),
        addressLine1: h.addressLine1,
        lng: h.location.lng,
        lat: h.location.lat,
        scope: 'unit',
        count: 1,
      },
      door: h,
      units: null,
    });
    idToRowKey.set(String(h.id), rowKey);
  }

  const byStreet = new Map();
  for (const r of rows) {
    const arr = byStreet.get(r.street);
    if (arr) arr.push(r);
    else byStreet.set(r.street, [r]);
  }
  const groups = [...byStreet.entries()].map(([street, list]) => ({
    street,
    rows: list.sort((a, b) => a.houseNumber - b.houseNumber || a.label.localeCompare(b.label)),
  }));
  groups.sort((a, b) => a.street.localeCompare(b.street, undefined, { numeric: true }));
  const rowKeys = groups.flatMap((g) => g.rows.map((r) => r.rowKey));
  return { groups, rowCount: rows.length, rowKeys, idToRowKey };
};

// The ADDRESS search, deliberately not a coordinate link: the point is seeing where Google
// puts the address so the pin can be dragged (or confirmed) to match — a coordinate link
// would just show Google our own possibly-wrong spot. Opened by the admin's own click (or
// their G keypress — a per-door, user-initiated action all the same) in a new tab, exactly
// the manual workflow it replaces; nothing is ever fetched by the app.
export const googleMapsUrl = (d = {}) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [d.addressLine1, d.city, `${d.state || ''} ${d.zipCode || ''}`.trim()].filter(Boolean).join(', ')
  )}`;

// Toast after a confirm. `updated` is the server's count of doors it stamped (res.updated).
export const confirmToast = (scope, updated) => {
  if (scope !== 'building') return 'Location confirmed.';
  const n = Number(updated) || 0;
  return `Building location confirmed · ${n.toLocaleString()} ${pluralize(n, 'unit')}`;
};

// Inline/toast error for the confirm POST — same shape as movePinErrorMessage.
export const confirmErrorMessage = (err) => {
  const code = err?.code || err?.data?.code || null;
  if (code === 'NOT_APPROXIMATE') return 'This pin is no longer approximate — the list may be stale, refresh it.';
  if (code === 'campaign-archived' || err?.status === 409) return 'This campaign is archived — pins are read-only.';
  if (code === 'FORBIDDEN_ROLE' || err?.status === 403) return 'Only campaign admins and team leads can confirm pins.';
  if (err?.status === 404) return 'This door is no longer in the campaign.';
  return err?.message || 'Could not confirm the location.';
};

// Every query a confirm (or its undo) can stale — the confirm twin of movePinInvalidationKeys.
// The Map page dots (ring goes out), the Turf pop-up drill (badge), this page's own list, and
// the campaigns rollup (the sidebar's pinsToFix badge).
export const confirmInvalidationKeys = (campaignId) => [
  ['admin', 'pin-fixes', campaignId],
  ['admin', 'households-map', campaignId],
  ['turf-household', campaignId],
  ['admin', 'campaigns'],
];
