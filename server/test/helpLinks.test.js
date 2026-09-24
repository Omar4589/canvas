import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Internal help links are role-gated, and the renderer does not know it.
//
// `[label](slug)` becomes a live react-router Link (client/src/components/help/HelpBlocks.jsx), with
// no existence or audience check. The article behind it is served only to roles whose audience set
// includes its `audience` (services/help/loadHelp.js), so an article written for one audience that
// links to a narrower one sends exactly its own reader to a not-found page. Sixteen of those had
// accumulated before this test existed, because nothing could see them: each file reads fine alone,
// and the breakage only exists in the relationship between two of them.
//
// Runs under plain `npm test` — no DB, no app boot: it reads the content tree and the audience map
// directly.
const here = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.resolve(here, '../src/content/help');

const { audiencesForRole } = await import('../src/services/help/loadHelp.js');
const ROLES = ['canvasser', 'lead', 'admin', 'super'];

// The same tiny frontmatter read loadHelp does (one `key: value` per line between --- fences).
const readMeta = (raw) => {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2] };
};

const articles = [];
for (const dir of fs.readdirSync(CONTENT)) {
  const full = path.join(CONTENT, dir);
  if (!fs.statSync(full).isDirectory()) continue;
  for (const fn of fs.readdirSync(full)) {
    // `_`-prefixed files (the FAQ inbox) are never served, so their links are notes, not links.
    if (!fn.endsWith('.md') || fn.startsWith('_')) continue;
    const parsed = readMeta(fs.readFileSync(path.join(full, fn), 'utf8'));
    if (!parsed) continue;
    articles.push({ file: `${dir}/${fn}`, ...parsed.meta, body: parsed.body });
  }
}

const bySlug = new Map(articles.map((a) => [a.slug, a]));
const canSee = (role, article) => !!article && audiencesForRole(role).includes(article.audience || 'all');
// Scheme-less hrefs are internal slugs; http(s) and mailto are somebody else's problem.
const internalLinks = (a) =>
  [...a.body.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)]
    .map((m) => m[1])
    .filter((href) => !/^(https?:|mailto:|#|\/)/i.test(href));

test('every help article parses its frontmatter and declares a slug', () => {
  for (const a of articles) {
    assert.ok(a.slug, `${a.file}: no slug — a leading blank line before --- is the usual cause, and the article is silently dropped`);
    assert.ok(a.title, `${a.file}: no title`);
  }
  assert.strictEqual(bySlug.size, articles.length, 'two articles share a slug');
});

test('no internal help link points at a slug that does not exist', () => {
  const dead = [];
  for (const a of articles) {
    for (const href of internalLinks(a)) if (!bySlug.has(href)) dead.push(`${a.file} -> ${href}`);
  }
  assert.deepStrictEqual(dead, [], `dead internal help links:\n  ${dead.join('\n  ')}`);
});

// The one this file exists for.
test('no help article links somewhere its own readers cannot follow', () => {
  const broken = [];
  for (const a of articles) {
    for (const href of internalLinks(a)) {
      const target = bySlug.get(href);
      if (!target) continue; // covered by the test above
      const stranded = ROLES.filter((r) => canSee(r, a) && !canSee(r, target));
      if (stranded.length) broken.push(`${a.file} (audience ${a.audience}) -> ${href} (audience ${target.audience}) — dead for: ${stranded.join(', ')}`);
    }
  }
  assert.deepStrictEqual(
    broken,
    [],
    `help links that send their own readers to a not-found page:\n  ${broken.join('\n  ')}\n\n` +
      'Fix by dropping the link and keeping the sentence, or by pointing at an article that reader can open. ' +
      'Widening the TARGET article’s audience is a disclosure decision, not a mechanical fix.'
  );
});
