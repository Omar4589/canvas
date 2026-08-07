// jsPDF's built-in ("Standard 14") faces are WinAnsi/cp1252 only — there is no way to
// print a character outside that range without embedding a TrueType font, and
// @fontsource-variable/inter ships woff2, which jsPDF cannot parse. So text headed for a
// PDF is folded to a printable equivalent FIRST, and anything that can't be folded is
// counted so the UI can warn before someone prints a stack of paper.
//
// The failure this prevents is silent: an unfolded U+2019 makes "O’Brien" render as
// "OBrien" with no error anywhere, and voter files carry curly apostrophes routinely.

// Typographic characters that have an honest ASCII equivalent.
const FOLD = {
  '‘': "'", '’': "'", '‚': ',', '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '–': '-', '—': '-', '‒': '-', '―': '-', '−': '-',
  '…': '...', '•': '-', '·': '-',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '​': '',
  '⁄': '/', '′': "'", '″': '"',
};

// cp1252 covers Latin-1 plus a handful of typographic slots. Accented Latin letters
// (é, ñ, ü, ø, å) are all inside it and print correctly — only characters beyond it
// (Cyrillic, CJK, Devanagari, most emoji) are unprintable.
const printable = (ch) => {
  const c = ch.codePointAt(0);
  if (c === 0x0a || c === 0x09) return true;
  if (c >= 0x20 && c <= 0x7e) return true;
  if (c >= 0xa0 && c <= 0xff) return true;
  return false;
};

// Fold what we can; drop what we can't. Never throws, never returns null — a name that
// cannot print still has to leave SOMETHING on the page for a volunteer to read.
export const asciiSafe = (value) => {
  const s = value == null ? '' : String(value);
  let out = '';
  for (const ch of s) {
    const folded = FOLD[ch];
    if (folded !== undefined) { out += folded; continue; }
    if (printable(ch)) { out += ch; continue; }
    // Strip diacritics as a last resort before giving up on the character.
    const stripped = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += stripped !== ch && [...stripped].every(printable) ? stripped : '';
  }
  return out;
};

// How many characters in a string would be LOST (not merely folded). Folding a curly
// quote to a straight one is not a loss worth warning about; dropping a Cyrillic name is.
export const countUnprintable = (value) => {
  const s = value == null ? '' : String(value);
  let n = 0;
  for (const ch of s) {
    if (FOLD[ch] !== undefined || printable(ch)) continue;
    const stripped = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!(stripped !== ch && [...stripped].every(printable))) n += 1;
  }
  return n;
};

// Walk a packet payload and report which VOTER NAMES will degrade, so the studio can say
// "2 names contain characters that can't print" before the admin commits to a print run.
export const scanUnprintableNames = (payload) => {
  const names = [];
  for (const book of payload?.books || []) {
    for (const door of book.doors || []) {
      for (const v of door.voters || []) {
        if (countUnprintable(v.name) > 0) names.push(v.name);
      }
    }
  }
  return { count: names.length, sample: names.slice(0, 5) };
};
