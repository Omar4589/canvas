// The one definition of "is this the same voter ID?".
//
// Vendors and campaign lists spell the same numeric ID with or without leading zeros: Georgia
// writes 08719967, Excel turns it into 8719967 the moment a file is opened and saved. Every
// comparison in the app is an exact string match today, so the two never meet. This module is
// where the rule lives, and nothing else may define it — the audit (migrations/
// auditVoterIdSpellings.js) reads with it, and the matching that follows (see
// docs/PROPOSAL_VOTER_ID_KEYS.md) will look up with it.
//
// The rule: an ID made only of digits is the same voter with or without leading zeros; an ID
// carrying anything else (a letter, a dash, the app's own `manual:<hex>` walk-up ids, the demo
// seed's `DEMO-IA-000001`) is only ever the same as itself — the letters mean the vendor formatted
// it on purpose. An all-zero ID is not an ID: some files stamp `0` or `00000000` on rows they
// could not identify, and stripping the zeros from that leaves nothing.

const DIGITS = /^[0-9]+$/;

// The comparable form of an ID, or null when the value carries no ID at all.
export const canonicalVoterId = (id) => {
  if (id == null) return null;
  const s = String(id).trim();
  if (s === '') return null;
  if (!DIGITS.test(s)) return s;
  const stripped = s.replace(/^0+/, '');
  return stripped === '' ? null : stripped;
};

// An all-zero placeholder ("0", "00000000"): non-empty, so it passes a presence check, but it
// identifies nobody.
export const isAllZeroId = (id) => /^0+$/.test(String(id ?? '').trim());

// The widest numeric ID any lookup will pad up to. North Carolina pads to 12, the widest known;
// 24 is a ceiling against a junk numeric column (a phone or a timestamp mapped as the ID) blowing
// every short ID up into twenty spellings.
export const MAX_VOTER_ID_WIDTH = 24;

// Every spelling a stored ID could have for one canonical ID: the bare number and each zero-padded
// width up to `maxWidth` (the widest numeric ID stored in the scope being searched). Searching for
// all of them at once is what makes matching symmetric — a stripped list reaches a padded campaign
// through the padded spellings, and a padded list reaches an unpadded campaign through the bare
// one. A letter-bearing ID is only ever itself; a null canonical (blank, all-zero) has no spellings.
export const voterIdVariants = (canonical, maxWidth) => {
  if (canonical == null) return [];
  if (!DIGITS.test(canonical)) return [canonical];
  const out = [canonical];
  const cap = Math.min(Number(maxWidth) || 0, MAX_VOTER_ID_WIDTH);
  for (let w = canonical.length + 1; w <= cap; w += 1) out.push(canonical.padStart(w, '0'));
  return out;
};
