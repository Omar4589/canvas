// CANONICAL survey script-text filler: the `{{canvasser}}` placeholder.
// Mirrored BYTE-FOR-BYTE (everything below the marker) into:
//   client/src/lib/surveyScriptText.js
//   mobile/lib/surveyScriptText.js
// Edit here, then copy the body to both mirrors. A drift-guard test (scriptText.test.js) enforces
// it. The body takes no imports: a relative path would resolve into three different trees.
// Design: docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md Part 2 §E2.
// ==== BEGIN MIRRORED BODY ====

// One placeholder, by ruling (2026-10-02, ruling 7): `{{canvasser}}` reads as the signed-in
// canvasser's first name. Dates and everything else stay typed by hand on every survey. Frozen
// because the server's save check reads this list: a stray push would make a typo legal.
export const PLACEHOLDER_TOKENS = Object.freeze(['canvasser']);

// What a missing name reads as: the client's own blank-line convention for "say your name here".
// Paper always prints it, since a walk packet is not personal to one canvasser.
export const BLANK = '______';

// A placeholder is `{{`, a name, `}}`, with whitespace around the name tolerated
// (`{{ canvasser }}`). The name may hold no brace, so a token is always the innermost brace-free
// pair and a stray `{{` can never swallow the real token after it. A fresh RegExp per call,
// because a shared /g pattern carries lastIndex from one call into the next.
const tokenPattern = () => /\{\{([^{}]*)\}\}/g;

const isKnownToken = (token) => PLACEHOLDER_TOKENS.includes(token);

// The one scan both exports run, so the save check and the phone can never disagree about what
// a placeholder is: a token is filled exactly when it is not reported as unknown. `visit` gets
// the trimmed name and the pair as typed; whatever it returns replaces the pair.
const eachToken = (text, visit) =>
  String(text).replace(tokenPattern(), (whole, inner) => visit(inner.trim(), whole));

// A non-string name (a stale cache, a hand-built bootstrap) reads as the blank, never "undefined".
const firstNameOrBlank = (name) =>
  typeof name === 'string' && name.trim() !== '' ? name.trim() : BLANK;

// Fill script text for reading aloud: the opening, the default closing, a statement's read-aloud
// body, an answer's read-aloud script, a canvasser note. NEVER a question's label or an answer's
// text (hasPlaceholderSyntax below says why). `options` is `{ canvasserFirstName }`; a missing or
// null one reads as no name, never a crash on the door screen. Unknown tokens stay exactly as
// typed: the save check refuses them, so one only gets here from a template saved before that
// check existed, and showing the braces beats guessing. The name goes in through a replacer
// FUNCTION, because a replacement STRING expands `$&`, `$1` and `$$`; and the filled text is
// never re-scanned, so a name can't fill itself. null/undefined text reads as ''.
export const fillScript = (text, options) => {
  if (text == null) return '';
  const name = firstNameOrBlank(options ? options.canvasserFirstName : undefined);
  // token -> what it reads as. A token added to PLACEHOLDER_TOKENS needs a value here; until it
  // has one it stays as typed (never "undefined"), and the every-token-fills test fails.
  const values = { canvasser: name };
  return eachToken(text, (token, whole) => {
    const value = isKnownToken(token) ? values[token] : null;
    return typeof value === 'string' ? value : whole;
  });
};

// The distinct names of every `{{…}}` pair that is not a known placeholder: trimmed, in order of
// first appearance, case-sensitive (`{{Canvasser}}` is a typo, not a spelling). Backs the
// server's save check on script text, a 400 naming the token, so a misspelt placeholder never
// reaches a phone as literal braces. An empty `{{}}` reports as ''. Only a CLOSED pair is a
// placeholder: an unmatched `{{` names nothing and is not reported here;
// `hasPlaceholderSyntax(fillScript(text))` is the stricter "no braces survive at all".
export const unknownPlaceholders = (text) => {
  if (text == null) return [];
  const names = [];
  eachToken(text, (token, whole) => {
    if (!isKnownToken(token) && !names.includes(token)) names.push(token);
    return whole;
  });
  return names;
};

// True when the text contains `{{` at all. A question's label and an answer's text may hold no
// placeholder, not even a known one: each is snapshotted onto every stored answer row
// (questionLabel / answer) and becomes a results label and a CSV cell, and none of those paths
// fill script text. So the save check refuses any `{{` there, stricter than unknownPlaceholders.
export const hasPlaceholderSyntax = (text) => text != null && String(text).includes('{{');
