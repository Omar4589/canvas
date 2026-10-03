import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PLACEHOLDER_TOKENS,
  BLANK,
  fillScript,
  unknownPlaceholders,
  hasPlaceholderSyntax,
} from './scriptText.js';

const here = dirname(fileURLToPath(import.meta.url));
const omar = { canvasserFirstName: 'Omar' };

test("one token by ruling, and the client's blank line", () => {
  assert.deepEqual(PLACEHOLDER_TOKENS, ['canvasser']);
  assert.ok(Object.isFrozen(PLACEHOLDER_TOKENS), 'the save check reads this list; nothing may push to it');
  assert.equal(BLANK, '______');
});

test('fillScript — {{canvasser}} becomes the trimmed first name', () => {
  assert.equal(fillScript('My name is {{canvasser}}.', omar), 'My name is Omar.');
  assert.equal(fillScript('{{canvasser}}', { canvasserFirstName: '  Omar \n' }), 'Omar');
  // The demo tenant's intro (seedDemoOrg.js) is the first real use, with no seed change.
  const demoIntro = "Hi, my name is {{canvasser}} — I'm a volunteer. Do you have a quick minute?";
  assert.equal(fillScript(demoIntro, omar), "Hi, my name is Omar — I'm a volunteer. Do you have a quick minute?");
  assert.deepEqual(unknownPlaceholders(demoIntro), []);
});

test('fillScript — every occurrence, whitespace inside the braces tolerated', () => {
  const text = '{{canvasser}} here. {{ canvasser }} again, {{canvasser  }} and {{\tcanvasser\n}}.';
  assert.equal(fillScript(text, omar), 'Omar here. Omar again, Omar and Omar.');
  // A statement body's paragraphs and line breaks come through untouched.
  const body = 'Thank you!\n\nI am {{canvasser}}, with the campaign.\nHave a good day!';
  assert.equal(fillScript(body, omar), 'Thank you!\n\nI am Omar, with the campaign.\nHave a good day!');
});

test('fillScript — a missing or blank name reads as the blank line', () => {
  const noName = [
    undefined,
    null,
    {},
    { canvasserFirstName: null },
    { canvasserFirstName: '' },
    { canvasserFirstName: '   ' },
    { canvasserFirstName: 42 },
  ];
  for (const options of noName) {
    const got = fillScript('My name is {{canvasser}}, {{canvasser}}.', options);
    assert.equal(got, 'My name is ______, ______.', String(JSON.stringify(options)));
  }
});

test('fillScript — the name goes in literally', () => {
  // A replacement STRING would expand each of these; the replacer function must not.
  for (const name of ['Jo$&', 'A$1', '$$', "Ma$'x", '$`']) {
    assert.equal(fillScript('I am {{canvasser}}.', { canvasserFirstName: name }), `I am ${name}.`);
  }
  // One pass: a name that looks like a token is not filled a second time.
  assert.equal(fillScript('{{canvasser}}!', { canvasserFirstName: '{{canvasser}}' }), '{{canvasser}}!');
});

test('fillScript — unknown tokens are left exactly as typed', () => {
  const text = '{{date}} / {{ Canvasser }} / {{}} / {{first name}} / {{constructor}} / {{canvasser}}';
  const want = '{{date}} / {{ Canvasser }} / {{}} / {{first name}} / {{constructor}} / Omar';
  assert.equal(fillScript(text, omar), want);
  const plain = 'Thank you for your time today.';
  assert.equal(fillScript(plain, omar), plain);
});

test('fillScript — null safety', () => {
  assert.equal(fillScript(null, omar), '');
  assert.equal(fillScript(undefined, omar), '');
  assert.equal(fillScript(undefined), '');
  assert.equal(fillScript('', omar), '');
  assert.equal(fillScript('{{canvasser}}', null), '______');
});

test('unknownPlaceholders — distinct unknown names, trimmed, case-sensitive', () => {
  assert.deepEqual(unknownPlaceholders('My name is {{canvasser}}, {{ canvasser }}.'), []);
  assert.deepEqual(unknownPlaceholders('Hi {{canvaser}}, vote {{date}}; {{ canvaser }} again'), ['canvaser', 'date']);
  assert.deepEqual(unknownPlaceholders('{{Canvasser}} and {{CANVASSER}}'), ['Canvasser', 'CANVASSER']);
  assert.deepEqual(unknownPlaceholders('{{first name}}'), ['first name']);
  assert.deepEqual(unknownPlaceholders('{{}} and {{  }}'), ['']);
  // Object-prototype names are typos like any other, never mistaken for a known token.
  assert.deepEqual(unknownPlaceholders('{{constructor}} {{__proto__}}'), ['constructor', '__proto__']);
  assert.deepEqual(unknownPlaceholders('Thank you for your time today.'), []);
  assert.deepEqual(unknownPlaceholders(''), []);
  assert.deepEqual(unknownPlaceholders(null), []);
  assert.deepEqual(unknownPlaceholders(undefined), []);
});

test('only a closed pair is a placeholder', () => {
  // An unmatched {{ names nothing: not reported, not filled. hasPlaceholderSyntax(fillScript(text))
  // is the check for "no braces survive at all", and it does catch it.
  const unclosed = 'My name is {{canvasser, nice to meet you';
  assert.deepEqual(unknownPlaceholders(unclosed), []);
  assert.equal(fillScript(unclosed, omar), unclosed);
  assert.equal(hasPlaceholderSyntax(fillScript(unclosed)), true);
  // A stray {{ never swallows the real token after it.
  const stray = '{{ oops {{canvasser}}';
  assert.equal(fillScript(stray, omar), '{{ oops Omar');
  assert.deepEqual(unknownPlaceholders(stray), []);
  assert.equal(hasPlaceholderSyntax(fillScript(stray)), true);
  // A text whose every pair is known leaves no braces behind, named or not.
  assert.equal(hasPlaceholderSyntax(fillScript('I am {{canvasser}}, {{ canvasser }}.')), false);
});

test('hasPlaceholderSyntax — any {{ at all', () => {
  assert.equal(hasPlaceholderSyntax('Can {{canvasser}} count on you?'), true); // even the known token
  assert.equal(hasPlaceholderSyntax('Yes {{ maybe'), true);
  assert.equal(hasPlaceholderSyntax('{{'), true);
  assert.equal(hasPlaceholderSyntax('Can Paul count on your support?'), false);
  assert.equal(hasPlaceholderSyntax('{ single } braces and }} closers'), false);
  assert.equal(hasPlaceholderSyntax(''), false);
  assert.equal(hasPlaceholderSyntax(null), false);
  assert.equal(hasPlaceholderSyntax(undefined), false);
});

test('every listed token is filled and never reported unknown', () => {
  for (const token of PLACEHOLDER_TOKENS) {
    const text = `[{{${token}}}] [{{ ${token} }}]`;
    assert.deepEqual(unknownPlaceholders(text), [], token);
    assert.equal(hasPlaceholderSyntax(fillScript(text, omar)), false, `{{${token}}} survived a fill`);
    assert.equal(hasPlaceholderSyntax(fillScript(text)), false, `{{${token}}} survived a nameless fill`);
  }
});

test('three script-text copies are byte-identical (drift guard)', () => {
  const MARK = '// ==== BEGIN MIRRORED BODY ====';
  const body = (p) => {
    const s = readFileSync(p, 'utf8');
    const i = s.indexOf(MARK);
    assert.notEqual(i, -1, `marker missing in ${p}`);
    return s.slice(i + MARK.length);
  };
  const canonical = body(join(here, 'scriptText.js'));
  const clientMirror = body(join(here, '../../../../client/src/lib/surveyScriptText.js'));
  const mobileMirror = body(join(here, '../../../../mobile/lib/surveyScriptText.js'));
  assert.equal(clientMirror, canonical, 'client/src/lib/surveyScriptText.js drifted from the canonical');
  assert.equal(mobileMirror, canonical, 'mobile/lib/surveyScriptText.js drifted from the canonical');
  // No imports: a relative path would resolve into three different trees.
  assert.doesNotMatch(canonical, /^\s*import\b/m, 'the mirrored body must stay import-free');
});
