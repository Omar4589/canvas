// The street a door is on, with the house number and any unit stripped — the CLIENT mirror
// of server/src/utils/streetName.js. Keep the two identical: the server's copy decides which
// stacked pins the pin-repair flags as placeholders, and this one decides which stacks the
// map's door panel WARNS about. If they drift, the panel warns about pins the repair won't
// touch (or vice versa), and the amber note stops being trustworthy.
//
// Why the panel can't just compare raw address lines: real files bake units INTO line1
// ("845 Collier Ct Apt 104" vs "Apt 204" — 6,344 rows in one real district file), so a
// genuine tower's lines all differ while its STREET is one. Raw-line comparison would brand
// every such building a "placeholder pin".

export const UNIT_SUFFIX = /\s+(?:apt|apartment|unit|ste|suite|bldg|building|lot|trlr|trailer|rm|room|fl|floor|#)\b\.?\s*\S*$/i;

export const streetOf = (line1) =>
  String(line1 || '')
    .trim()
    .replace(/^\d+[A-Za-z]?\s+/, '')
    .replace(/\s+#.*$/, '')
    .replace(UNIT_SUFFIX, '')
    .trim() || '(no street)';
