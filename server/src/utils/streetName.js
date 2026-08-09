// The street a door is on, with the house number and any unit stripped.
//
// Lifted out of services/packet/buildPacket.js so the walk-packet street bands and the
// pin-repair audit group addresses the same way. They must: the repair script decides
// "is this pin an outlier among its neighbours", and if it split a 40-door building into
// nineteen streets (the exact bug the UNIT_SUFFIX strip exists to prevent — "Bay Harbor
// Blvd Apt 101 … Apt 308") every cohort would be too small to vote.

export const UNIT_SUFFIX = /\s+(?:apt|apartment|unit|ste|suite|bldg|building|lot|trlr|trailer|rm|room|fl|floor|#)\b\.?\s*\S*$/i;

export const streetOf = (line1) =>
  String(line1 || '')
    .trim()
    .replace(/^\d+[A-Za-z]?\s+/, '')
    .replace(/\s+#.*$/, '')
    .replace(UNIT_SUFFIX, '')
    .trim() || '(no street)';

// The BASE ADDRESS: house number KEPT, unit stripped. This is the key that tells a real
// building from a same-street collapse — a genuine building is ONE house number with many
// units ("900 Aqua Isles Blvd Lot 1/2/3" → one base), while a vendor that stamped its
// unplaceable County Rd 78 addresses onto one point ON County Rd 78 produces many bases
// ("1644 / 2282 / 3530 County Rd 78") that streetOf alone cannot tell apart — the street
// matches, the houses are miles apart.
export const baseAddressOf = (line1) =>
  String(line1 || '')
    .trim()
    .replace(/\s+#.*$/, '')
    .replace(UNIT_SUFFIX, '')
    .trim() || '(no address)';
