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
// ── Causes (the pin-fixes build, docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S10.1) ────────────────────
// Why a door is in the queue, from its effective pinSuspect (sent only while the pin is not the home, and
// always for a complex) and its coordConfidence. A building row reads its first unit.
const causeOfDoor = (d) => {
  const ps = d?.pinSuspect;
  if (ps === 'far') return 'far';
  if (ps === 'unlocated') return 'unlocated';
  if (ps === 'complex') return 'complex';
  if (ps) return 'shared';
  return 'approx';
};
export const rowCause = (row) => (row?.kind === 'complex' ? 'complex' : causeOfDoor(row?.door));
const CAUSE_SUB = {
  shared: 'No exact map spot',
  far: 'Pinned far from its street',
  unlocated: "Couldn't be found by address",
  complex: 'A complex',
  approx: null,
};
export const causeSub = (cause) => CAUSE_SUB[cause] ?? null;

// `includeComplex`: complex members normally arrive in the payload's own `complexes` list and are left
// out of the street list; buildGroups passes true to build each complex's member rows.
export const buildStreetGroups = (households, { includeComplex = false } = {}) => {
  const byAddress = new Map();
  for (const h of households || []) {
    if (!includeComplex && h.pinSuspect === 'complex') continue;
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
        sub: unplaced ? causeSub(causeOfDoor(first)) : `${units.length} ${pluralize(units.length, 'unit')} at one pin`,
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
      sub: unplaced ? causeSub(causeOfDoor(h)) : null,
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

// Toast after a confirm. `updated` is the server's count of doors it stamped (res.updated). A complex
// ('spot', the pin-fixes build) vouches every member at once.
export const confirmToast = (scope, updated) => {
  const n = Number(updated) || 0;
  if (scope === 'spot') return `Confirmed ${n.toLocaleString()} ${pluralize(n, 'home')} at the complex`;
  if (scope !== 'building') return 'Location confirmed.';
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
// A complex row is the same: its confirm vouches every home on the spot, so it is always a click.
export const enterAction = (row) => (row && !row.unplaced && row.kind !== 'complex' ? 'confirm' : null);

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
// The same question for a home pinned far from its street.
export const FAR_CONFIRM_PROMPT = "This home's pin sits far from the rest of its street. Confirm the home is really here?";
export const confirmPrompt = (row) => (rowCause(row) === 'far' ? FAR_CONFIRM_PROMPT : UNPLACED_CONFIRM_PROMPT);
// The confirm button's label — or null where there is no confirm at all: a home parked at a holding spot
// (that spot is by definition not the home; the server refuses the vouch too).
export const confirmLabel = (row) => {
  if (rowCause(row) === 'unlocated') return null;
  return row?.unplaced ? 'Looks right — the home is here' : 'Looks right — confirm';
};

// A coordinate at Null Island (the vendor's "no location", 0,0): the page never flies there — an
// outside-state point is still on a map, so 0,0 is the only case that needs a detour. The server's
// isOffWorld (utils/stateBounds.js) in its argument order.
export const isOffWorld = (lat, lng) => Math.abs(lat) < 1e-5 && Math.abs(lng) < 1e-5;

// ── Fix together: the cards above the street list (S10.1) ─────────────────────────────────────────
// From the /pin-fixes payload: the street rows grouped by cause, the condo complexes (one pseudo-row per
// complex, rowKey 'c:<key>', plus each complex's member rows — built like street rows, so one address's
// units stay one 'building' row — which Spread on the map arms), and the set-aside homes.
// Each card: { kind, title, count (homes), spots, rowKeys, actions } — action ids the page renders:
//   lookup (Look up by address) · place (Place along the street) · setAside · check (Start checking)
//   · vouchSpot (Looks right — it's a complex) · spread (Spread on the map).
// Cards with nothing in them are left out.
const CARD_TITLES = {
  shared: 'Share one spot with other addresses',
  far: 'Pinned far from their street',
  unlocated: "Couldn't be found by address",
  complexes: 'Complexes',
  approx: 'Placed on the street, not the house',
};
// One sentence per card, under its title (the proposal's Part 1 §6 words).
const CARD_BLURBS = {
  shared: 'The file gave these homes one coordinate, and the address lookup couldn’t place them.',
  far: 'Each pin sits far from the rest of its street. The address lookup couldn’t settle these.',
  unlocated:
    'No location in the file, and the address lookup found nothing. They wait at a holding spot in their ZIP and are left out of book cuts until placed.',
  complexes: 'Each spot is one complex: the file and the address lookup agree every home on it is here.',
  approx: 'The lookup put these on the right block. Check each one on satellite: Enter = Looks right, or drag it onto the roof.',
};
const CARD_ACTIONS = {
  shared: ['lookup', 'place', 'setAside'],
  far: ['lookup', 'setAside'],
  unlocated: ['lookup', 'place', 'setAside'],
  complexes: ['vouchSpot', 'spread'],
  approx: ['check'],
};
const homesIn = (rows) => rows.reduce((n, r) => n + (r.units?.length || r.count || 1), 0);
// The card's busiest streets, homes per street, most first ("42 on Foxboro Dr · 9 on Thomas Pl").
const topStreets = (rows, max = 3) => {
  const by = new Map();
  for (const r of rows) {
    for (const st of r.kind === 'complex' ? r.streets : [r.street]) {
      if (st) by.set(st, (by.get(st) || 0) + (r.kind === 'complex' ? 0 : r.units?.length || 1));
    }
  }
  return [...by.entries()]
    .map(([street, count]) => ({ street, count }))
    .sort((a, b) => b.count - a.count || a.street.localeCompare(b.street, undefined, { numeric: true }))
    .slice(0, max);
};
export const buildGroups = ({ households = [], complexes = [], setAside = [] } = {}) => {
  const street = buildStreetGroups(households);
  const byCause = { shared: [], far: [], unlocated: [], approx: [] };
  for (const g of street.groups) for (const r of g.rows) byCause[rowCause(r)]?.push(r);

  const complexRows = [];
  const memberRows = [];
  const memberIdToRowKey = new Map();
  for (const c of complexes || []) {
    const members = buildStreetGroups(c.rows || [], { includeComplex: true });
    const memberRowKeys = members.rowKeys;
    for (const g of members.groups) memberRows.push(...g.rows);
    for (const [id, key] of members.idToRowKey) memberIdToRowKey.set(id, key);
    const first = c.rows?.[0] || null;
    const lng = Number.isFinite(c.lng) ? c.lng : first?.location?.lng;
    const lat = Number.isFinite(c.lat) ? c.lat : first?.location?.lat;
    complexRows.push({
      rowKey: `c:${c.key}`,
      kind: 'complex',
      label: `${(c.streets || []).join(' · ') || 'A complex'} — ${c.count} ${pluralize(c.count, 'home')}`,
      sub: causeSub('complex'),
      unplaced: false,
      spot: buildingKeyForCoords(lng, lat),
      lng,
      lat,
      count: c.count,
      streets: c.streets || [],
      memberRowKeys,
      door: first,
      units: c.rows || [],
      target: first
        ? { id: String(first.id), addressLine1: first.addressLine1, lng, lat, scope: 'spot', count: c.count, unplaced: false }
        : null,
    });
  }

  const cards = [];
  const push = (kind, rows) => {
    if (!rows.length) return;
    cards.push({
      kind,
      title: CARD_TITLES[kind],
      blurb: CARD_BLURBS[kind],
      count: kind === 'complexes' ? rows.reduce((n, r) => n + (r.count || 0), 0) : homesIn(rows),
      spots: new Set(rows.map((r) => r.spot)).size,
      rowKeys: rows.map((r) => r.rowKey),
      streets: kind === 'complexes' ? [] : topStreets(rows),
      actions: CARD_ACTIONS[kind],
    });
  };
  push('shared', byCause.shared);
  push('far', byCause.far);
  push('unlocated', byCause.unlocated);
  push('complexes', complexRows);
  push('approx', byCause.approx);
  return { street, cards, complexRows, memberRows, memberIdToRowKey, setAside: setAside || [] };
};

// The card header's count line: "86 homes · 9 spots" where a spot holds several, else "19 homes".
export const cardCountLine = (card) => {
  const homes = `${Number(card?.count || 0).toLocaleString()} ${pluralize(card?.count || 0, 'home')}`;
  const spots = Number(card?.spots) || 0;
  return card?.kind === 'complexes' || (card?.kind === 'shared' && spots > 0 && spots < card.count)
    ? `${homes} · ${spots.toLocaleString()} ${pluralize(spots, 'spot')}`
    : homes;
};

// Every door id in a list of rows (a building row's units included) — what Set aside sends.
export const doorIdsOfRows = (rows) => {
  const ids = [];
  for (const r of rows || []) {
    if (r?.units?.length) for (const u of r.units) ids.push(String(u.id));
    else if (r?.door?.id) ids.push(String(r.door.id));
  }
  return [...new Set(ids)];
};

// The one question Set aside asks.
export const setAsidePrompt = (n) =>
  `Set aside ${Number(n).toLocaleString()} ${pluralize(n, 'home')}? ${n === 1 ? 'It leaves' : 'They leave'} the queue and every book cut until brought back.`;
export const setAsideToast = (n) => `Set aside ${Number(n).toLocaleString()} ${pluralize(n, 'home')}.`;
export const bringBackToast = (n) =>
  `Brought back ${Number(n).toLocaleString()} ${pluralize(n, 'home')} — ${n === 1 ? 'it is' : 'they are'} in the queue and book cuts again.`;

// Look up by address (POST …/households/pin-lookup → an ImportJob of kind 'pin_lookup', polled through
// GET /admin/imports/:id). Active until the worker marks it completed or failed.
export const isLookupActive = (job) => !!job && job.status !== 'completed' && job.status !== 'failed';
// The toast when it ends: the import pin line's words when it ran, its own sentence when busy or failed
// (they end "click Look up by address again"), and "0 placed" when nothing changed.
export const lookupToast = (job, pinLineOf) => {
  if (!job) return null;
  if (job.status === 'failed') return { text: job.lastError || "The lookup couldn't run. Try again in a minute.", tone: 'error' };
  if (job.pinPassError) return { text: job.pinPassError, tone: 'error' };
  const line = pinLineOf?.(job);
  return { text: line?.text || 'Map pins: 0 placed — nothing changed.' };
};
// The POST's refusals, in the server's words where it has them.
export const lookupErrorMessage = (err) => {
  const code = err?.code || err?.data?.code || null;
  if (code === 'LOOKUPS_OFF') return err.message || 'Address lookups are switched off for now.';
  if (code === 'NOTHING_TO_LOOK_UP') return 'Nothing to look up — the list may be stale, refresh it.';
  if (code === 'FORBIDDEN_ROLE' || err?.status === 403) return 'Only campaign admins and team leads can look pins up.';
  return err?.message || "The lookup couldn't be started.";
};

// Start checking (the approximate card): the street list narrowed to a set of row keys, empty streets
// dropped. `scope` null → the groups unchanged.
export const scopedGroups = (groups, scope) => {
  if (!scope) return groups;
  return groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => scope.has(r.rowKey)) }))
    .filter((g) => g.rows.length > 0);
};

// Place along the street: where the camera goes for a row. A row at 0,0 (the vendor's "no location") never
// sends it to the ocean: it goes to the middle of the same street's other rows, else to `fallback` (the
// queue's middle), else nowhere (null).
const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
export const middleOf = (points) => {
  const ok = (points || []).filter((p) => Number.isFinite(p?.lng) && Number.isFinite(p?.lat) && !isOffWorld(p.lat, p.lng));
  if (!ok.length) return null;
  return { lng: median(ok.map((p) => p.lng)), lat: median(ok.map((p) => p.lat)) };
};
export const placeFlyTarget = (row, rows, fallback = null) => {
  if (!row) return null;
  if (Number.isFinite(row.lng) && Number.isFinite(row.lat) && !isOffWorld(row.lat, row.lng)) return { lng: row.lng, lat: row.lat };
  return middleOf((rows || []).filter((r) => r !== row && r.street === row.street)) || fallback;
};

// The house-number labels Place along the street draws beside the homes to place: every door in view
// that is NOT in the queue, labelled with the leading number of its street address (numbering direction
// and the odd/even side, at a glance). `queueIds`: a Set of the queue's door ids.
export const neighbourNumbersGeoJSON = (households, queueIds) => ({
  type: 'FeatureCollection',
  features: (households || []).flatMap((h) => {
    const num = String(h?.addressLine1 || '').match(/^\s*(\d+[A-Za-z]?)\b/)?.[1];
    const lng = h?.location?.lng;
    const lat = h?.location?.lat;
    if (!num || !Number.isFinite(lng) || !Number.isFinite(lat) || queueIds?.has(String(h.id))) return [];
    return [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { num } }];
  }),
});
