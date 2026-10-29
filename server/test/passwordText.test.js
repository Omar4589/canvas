import { test } from 'node:test';
import assert from 'node:assert';
import { isWellFormedText } from '../src/utils/passwordText.js';

// A password only reaches bcrypt when it is well-formed text — a lone surrogate makes bcryptjs 2.4.3 run
// out of memory and the process exit (utils/passwordText.js; the routes are pinned in
// passwordText.int.test.js).

test('ordinary passwords, accents and emoji are well-formed text', () => {
  for (const pw of ['Str0ng!Passw0rd', 'k7Hq9mXrW2pZ', 'contraseña-segura', 'pass word 🙂 ok', '']) {
    assert.strictEqual(isWellFormedText(pw), true, JSON.stringify(pw));
  }
});

test('half of a surrogate pair is not, wherever it sits', () => {
  for (const pw of ['abcdefghijk\ud800', 'abc\ud800defghijk', '\udc00abcdefghijk', 'abcdefghij\ude00\ud83d']) {
    assert.strictEqual(isWellFormedText(pw), false, JSON.stringify(pw));
  }
});

test('anything that is not a string is not', () => {
  for (const v of [undefined, null, 12, {}, ['a']]) assert.strictEqual(isWellFormedText(v), false);
});
