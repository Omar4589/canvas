// The street a door is on, and the "same street address" key — the PHONE mirror of
// server/src/utils/streetName.js (and of the web copy, client/src/lib/streetName.js). The server copy decides
// what a shared map spot is and what "Whole building" moves; this one decides which homes the canvasser map
// lists together, which units Fix pin asks about ("Just this unit / Whole building"), and how the homes
// screen sorts. Pinned to the server copy by server/test/streetNameDrift.test.js — change all three, or that
// test fails. Self-contained on purpose: mobile/lib tests load it in node with no install.

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

// ── One street address ───────────────────────────────────────────────────────────────────────
// The CLIENT mirror of server/src/utils/streetName.js's stackBaseOf, the "same street address" key:
// Pin Fixes groups one address's units on one spot into one row with it, matching the server's
// move and confirm fan-outs. Pinned to the server copy by server/test/streetNameDrift.test.js —
// change both, or that test fails. STREET_WORDS is the server's table (utils/normalizeAddress.js).
export const STREET_WORDS = {
  ST: 'STREET', STR: 'STREET', AVE: 'AVENUE', AV: 'AVENUE', RD: 'ROAD', DR: 'DRIVE',
  BLVD: 'BOULEVARD', LN: 'LANE', CT: 'COURT', PL: 'PLACE', TER: 'TERRACE', TERR: 'TERRACE',
  CIR: 'CIRCLE', PKWY: 'PARKWAY', HWY: 'HIGHWAY', SQ: 'SQUARE', TRL: 'TRAIL', PT: 'POINT',
  N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST',
  NE: 'NORTHEAST', NW: 'NORTHWEST', SE: 'SOUTHEAST', SW: 'SOUTHWEST',
};

export const DIRECTIONALS = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'NORTH', 'SOUTH', 'EAST', 'WEST', 'NORTHEAST', 'NORTHWEST', 'SOUTHEAST', 'SOUTHWEST'];
// Road-type words beyond STREET_WORDS. Only ever tested against, never mapped: STREET_WORDS is also
// the geocode cache key's table, so it is not widened.
export const EXTRA_STREET_TYPES = ['WAY', 'LOOP', 'PATH', 'ROW', 'RUN', 'PIKE', 'ALY', 'ALLEY', 'CV', 'COVE', 'XING', 'CROSSING', 'BND', 'BEND', 'TRCE', 'TRACE', 'WALK', 'PLZ', 'PLAZA', 'EXPY', 'EXPRESSWAY', 'FWY', 'FREEWAY', 'TPKE', 'TURNPIKE'];
// The street-ending test: the remainder's last word is one of these, or a number.
const STREET_END = new Set([...Object.keys(STREET_WORDS), ...Object.values(STREET_WORDS), ...EXTRA_STREET_TYPES]);
// A street-type word is never a unit id ("Forest Floor Dr", "Lake Lot Dr"). Directionals can be ("Apt N").
const STREET_TYPE = new Set([...STREET_END].filter((w) => !DIRECTIONALS.includes(w)));
// A unit id for the second id slot, the guarded words and the standalone words:
// digit-led (5, 5B, 12-3), letter + digits (B12, K25, B-2), or a single letter (B).
const UNITID = '(?:\\d+[A-Z]?(?:-[A-Z0-9]{1,4})?|[A-Z]-?\\d{1,4}[A-Z]?|[A-Z])';
// Designators that always carry an id: any one token, then optionally one more unit id ("Apt 5 B").
export const WITH_ID = ['APT', 'APARTMENT', 'UNIT', 'STE', 'SUITE', 'BLDG', 'BUILDING', 'LOT', 'TRLR', 'TRAILER', 'RM', 'ROOM', 'FL', 'FLOOR', 'SPC', 'DEPT', 'HNGR'];
const RE_WITH_ID = new RegExp(`\\s+(?:${WITH_ID.join('|')})\\.?\\s+([A-Z0-9][A-Z0-9/-]*)(?:\\s+${UNITID})?$`);
// The same words bare at the end ("… St Apt", "… Rear Apt", "… 2nd Floor").
const RE_WITH_ID_BARE = new RegExp(`\\s+(${WITH_ID.join('|')})\\.?$`);
// Glued digit forms, an optional hyphen allowed: APT5, APT-5, SPC12, UNIT3B.
const RE_GLUED = /\s+(?:APT|UNIT|STE|SPC|LOT|BLDG)-?\d+[A-Z]?$/;
// Guarded designators: only with a unit id after them ("Slip 12", never "100 Slip 5").
export const GUARDED = ['SIDE', 'SP', 'SPACE', 'SLIP'];
const RE_GUARDED = new RegExp(`\\s+(?:${GUARDED.join('|')})\\.?\\s+${UNITID}$`);
// Standalone designators: with a unit id after them, or bare at the end when what precedes ends like a street.
export const STANDALONE = ['PH', 'PENTHOUSE', 'UPPR', 'UPPER', 'LOWR', 'LOWER', 'REAR', 'FRNT', 'FRONT', 'BSMT', 'BASEMENT', 'LBBY', 'LOBBY', 'OFC', 'OFFICE'];
const STANDALONE_SET = new Set(STANDALONE);
const RE_STANDALONE = new RegExp(`\\s+(?:${STANDALONE.join('|')})\\.?(?:\\s+(${UNITID}))?$`);
// Every with-id designator joined to its id by '-', '/' or '#' loses the joiner ("Apt-B", "Ste/5",
// "Apt #5" → "APT B"…). Global, so "Bldg-3 Apt-B" loses both.
const RE_JOINER = new RegExp(`(\\s(?:${WITH_ID.join('|')}))\\.?\\s*[-/#]\\s*(?=[A-Z0-9])`, 'g');
const ORDINAL = /^\d+(?:ST|ND|RD|TH)$/;
const twoWords = (t) => /^\S+\s+\S+/.test(t);
const lastWord = (t) => t.split(' ').pop();
const endsLikeStreet = (t) => /^\d+$/.test(lastWord(t)) || STREET_END.has(lastWord(t));

// Steps 1–2: upper-case; rewrite the joiners; drop any other '#…' tail when something precedes it
// (keeping it as `hashTail`, the unit homeKeyOf reads); every character outside A-Z 0-9 / ½ - and
// space becomes a space (accented letters included: "Peña" reads "PE A" — only ever compared within
// one spot); collapse; fold a hyphenated house-number letter ("12-A" → "12A", never "12 A St").
const cleanWithTail = (line1) => {
  const up = String(line1 || '').toUpperCase().replace(RE_JOINER, '$1 ');
  const m = up.match(/^(.*?\S)\s*(#.*)$/);
  const s = (m ? m[1] : up)
    .replace(/[^A-Z0-9/½ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(\d+)\s*-\s*([A-Z])(?=\s)/, '$1$2');
  return { s, hashTail: m ? m[2] : '' };
};

// Step 3, one strip. Every form must leave at least two words, so "1234 RM 2222" and "100 Lot Rd" stay streets.
const stripOnce = (s) => {
  let m = s.match(RE_WITH_ID);
  if (m) {
    const t = s.slice(0, m.index).trim();
    // A street-type id is accepted only after a remainder that already ends in one and has 3+ words
    // ("… NW 5th Ln Apt Pt").
    if (twoWords(t) && (!STREET_TYPE.has(m[1]) || (STREET_TYPE.has(lastWord(t)) && t.split(' ').length >= 3))) return t;
  }
  for (const re of [RE_GLUED, RE_GUARDED]) {
    m = s.match(re);
    if (m) {
      const t = s.slice(0, m.index).trim();
      if (twoWords(t)) return t;
    }
  }
  m = s.match(RE_STANDALONE);
  if (m) {
    const t = s.slice(0, m.index).trim();
    if (twoWords(t) && (m[1] || endsLikeStreet(t))) return t;
  }
  // A bare with-id word at the end: when the remainder ends like a street or with a standalone word
  // ("Rear Apt"), and FL/FLOOR together with the ordinal before it ("2nd Floor").
  m = s.match(RE_WITH_ID_BARE);
  if (m) {
    const t = s.slice(0, m.index).trim();
    if (twoWords(t) && (endsLikeStreet(t) || STANDALONE_SET.has(lastWord(t)))) return t;
    if ((m[1] === 'FL' || m[1] === 'FLOOR') && ORDINAL.test(lastWord(t))) {
      const t2 = t.slice(0, t.length - lastWord(t).length).trim();
      if (twoWords(t2) && endsLikeStreet(t2)) return t2;
    }
  }
  return s;
};

// The strip helper stackBaseOf uses (on the server, isUnitAddress and homeKeyOf share it too).
// `stripped`: step 3 removed something. `unit`: what it removed (strips only remove a suffix), then
// any '#' tail step 1 dropped.
export const stripUnits = (line1) => {
  const { s: s0, hashTail } = cleanWithTail(line1);
  let s = s0;
  let prev;
  do {
    prev = s;
    s = stripOnce(s);
  } while (s !== prev);
  return { s, stripped: s !== s0, unit: `${s0.slice(s.length)} ${hashTail}`.trim() };
};

// Steps 4–5: fold a glued house-number suffix (123A, 123 1/2, 123½ → 123; never a bare "12 A"),
// then map each word through STREET_WORDS.
export const stackBaseOf = (line1) => {
  const s = stripUnits(line1).s.replace(/^(\d+)(?:[A-Z]|½|\s+1\/2)(?=\s)/, '$1');
  return s.split(' ').filter(Boolean).map((w) => STREET_WORDS[w] || w).join(' ') || '(NO ADDRESS)';
};
