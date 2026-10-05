// Pin Fixes — the pure half of the queue page (street grouping, the Google Maps link, toast +
// error copy, the cache contract). No React, no api, no mapbox, so `node --test src/` pins it
// (pinFixes.test.js) — the same split movePin.js uses for the move-pin feature.

import { buildingKeyForCoords } from './buildings.js';
import { streetOf, baseAddressOf, stackBaseOf } from './streetName.js';
import { pluralize } from './mapCounts.js';

// Queue rows from the /pin-fixes payload: one row per street address per PIN — the set the
// server's move and confirm fan-outs act on (scope:'building' = the units of ONE street address on
// one ~1.1m pin, stackBaseOf). So an apartment building's units share a row, and separate homes that
// a vendor stamped with one shared coordinate get a row each (docs/PROPOSAL_PLACEHOLDER_PINS.md §I).
// Grouped by street (streetOf — house number + unit stripped) because that's how the list is worked:
// one street at a time against the imagery. Streets sort A→Z numeric-aware; rows by house number,
// then label.
//
// Returns { groups: [{ street, rows }], rowCount, rowKeys, idToRowKey, spotRowKeys } where each row is
//   { rowKey, kind: 'building'|'door', label, sub, unplaced, spot, lng, lat, target, door, units }
// and `target` is exactly what useMovePin.start() and the confirm POST take. `unplaced`: the row's
// doors have no exact map spot (the payload's effective pinSuspect) — Enter never confirms them and
// Looks right asks first. `units` is the building's full unit list (null on door rows) — the action
// popup renders it. idToRowKey maps EVERY door id (stacked units included) to its row, for the map's
// pin-click handler. `rowKeys` is the flattened street-sorted order — the ONE order Next/Prev and
// auto-advance walk, kept here (not re-derived in the page) so the tests pin it. `spotRowKeys` maps a
// map spot (`spot`, the ~1.1m building key) to its rows in that order: the map still draws one glyph
// per spot, and a spot whose homes have different addresses holds several rows (pickSpotRow).
const UNPLACED_SUB = 'No exact map spot';
export const buildStreetGroups = (households) => {
  const byAddress = new Map();
  for (const h of households || []) {
    const key = buildingKeyForCoords(h.location?.lng, h.location?.lat);
    if (!key) continue;
    const k = `${key}#${stackBaseOf(h.addressLine1)}`;
    const list = byAddress.get(k);
    if (list) list.push(h);
    else byAddress.set(k, [h]);
  }
  const rows = [];
  const idToRowKey = new Map();
  for (const [k, units] of byAddress) {
    const first = units[0];
    const unplaced = units.some((u) => !!u.pinSuspect);
    const spot = k.slice(0, k.indexOf('#'));
    if (units.length >= 2) {
      const rowKey = `b:${k}`;
      const address = baseAddressOf(first.addressLine1);
      const label = unplaced ? `${units.length} units at ${address}` : address;
      rows.push({
        rowKey,
        kind: 'building',
        label,
        sub: unplaced ? UNPLACED_SUB : `${units.length} ${pluralize(units.length, 'unit')} at one pin`,
        unplaced,
        spot,
        street: streetOf(first.addressLine1),
        houseNumber: parseInt(first.addressLine1, 10) || 0,
        lng: first.location.lng,
        lat: first.location.lat,
        target: {
          id: String(first.id),
          addressLine1: address,
          lng: first.location.lng,
          lat: first.location.lat,
          scope: 'building',
          count: units.length,
          unplaced,
        },
        door: first,
        units,
      });
      for (const u of units) idToRowKey.set(String(u.id), rowKey);
      continue;
    }
    const h = first;
    const rowKey = `h:${h.id}`;
    rows.push({
      rowKey,
      kind: 'door',
      label: h.addressLine2 ? `${h.addressLine1} ${h.addressLine2}` : h.addressLine1,
      sub: unplaced ? UNPLACED_SUB : null,
      unplaced,
      spot,
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
        unplaced,
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
  const spotRowKeys = new Map();
  for (const g of groups) {
    for (const r of g.rows) {
      const list = spotRowKeys.get(r.spot);
      if (list) list.push(r.rowKey);
      else spotRowKeys.set(r.spot, [r.rowKey]);
    }
  }
  return { groups, rowCount: rows.length, rowKeys, idToRowKey, spotRowKeys };
};

// A click on a map spot's glyph: its first row, or — when the selection is already one of the spot's
// rows — the next one, wrapping, so clicking again steps through every home on a shared spot.
export const pickSpotRow = (spotRowKeys, spot, currentKey) => {
  const keys = spotRowKeys?.get(spot);
  if (!keys?.length) return null;
  return keys[(keys.indexOf(currentKey) + 1) % keys.length];
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

// Inline/toast error for the confirm POST — same shape as movePinErrorMessage. PIN_CHANGED is
// checked before the bare 409: this router's other 409s mean an archived or deleting campaign.
export const confirmErrorMessage = (err) => {
  const code = err?.code || err?.data?.code || null;
  if (code === 'PIN_CHANGED') return 'This pin changed since the page loaded — reloading.';
  if (code === 'NOT_APPROXIMATE') return 'This pin is no longer approximate — the list may be stale, refresh it.';
  if (code === 'campaign-archived' || code === 'campaign-deleting' || err?.status === 409) return 'This campaign is archived — pins are read-only.';
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

// Refusals after which the list is stale: the page refetches it (window-focus refetch is off).
export const confirmNeedsRefetch = (err) => ['PIN_CHANGED', 'NOT_APPROXIMATE'].includes(err?.code || err?.data?.code);

// ── Keyboard and prompts ──────────────────────────────────────────────────────────────────────
// What Enter does on a row: confirm an approximate pin, as today — and nothing on a home without an
// exact map spot, so a confirm there always takes the explicit click that asks first (the owner's
// decision of 2026-10-05). Auto-advance would otherwise vouch a whole shared spot, one key per row.
export const enterAction = (row) => (row && !row.unplaced ? 'confirm' : null);

// The popup's key map, pure because the render smoke harness never attaches listeners.
export const popupKeyAction = (key, row) => {
  if (key === 'ArrowLeft') return 'prev';
  if (key === 'ArrowRight') return 'next';
  if (key === 'Enter') return enterAction(row);
  if (key === 'g' || key === 'G') return 'maps';
  if (key === 'Escape') return 'close';
  return null;
};

// The popup's footer hint: no "Enter confirm" where Enter does nothing.
export const popupHint = (row) =>
  enterAction(row) ? 'Enter confirm · ← → next / prev · G maps · Esc close' : '← → next / prev · G maps · Esc close';

// The one-line question Looks right asks on a home without an exact map spot. It names no count:
// the page loads only the queue, so the spot's other homes aren't in it to be counted.
export const UNPLACED_CONFIRM_PROMPT =
  "This home's map spot was shared with other addresses. Confirm the home is really here?";
export const confirmLabel = (row) => (row?.unplaced ? 'Looks right — the home is here' : 'Looks right — confirm');
