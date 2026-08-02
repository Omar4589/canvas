import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

// The production web surface over the REAL Express app — the `curl` contract:
//   · /privacy, /terms, /delete-account return their full text with ZERO JavaScript;
//   · unknown top-level paths return a real HTTP 404, never a 200 + silent bounce to "/";
//   · every known client route (incl. the emailed /r/:token report links) still gets the shell;
//   · unknown /api paths still get the JSON 404.
//
// Runs against a FIXTURE dist (CLIENT_DIST override) so the routing matrix needs no client
// build, then asserts the REAL committed documents in client/public/ — those are the files a
// build copies into dist verbatim, so testing them IS testing what production serves.
//
// NODE_ENV and CLIENT_DIST are read at app.js MODULE EVAL — set them before the import.
//
// Skip gate: this suite needs NO database, but createApp() opens BullMQ producer queues whose
// ioredis handles retry forever — under plain `npm test` (no --test-force-exit) they would hang
// the run at exit. So it runs only under `npm run test:int`, whose harness both sets
// MONGODB_URI_TEST and passes --test-force-exit. Same gate as every other *.int.test.js.
const skip = process.env.MONGODB_URI_TEST
  ? false
  : 'runs under test:int (createApp opens queue handles; needs --test-force-exit)';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '../../client/public');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'doorline-dist-'));
fs.mkdirSync(path.join(fixture, 'assets'));
fs.writeFileSync(
  path.join(fixture, 'index.html'),
  '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/index-abc.js"></script></body></html>'
);
// The four committed documents, copied in exactly as a client build would copy them.
for (const f of ['privacy.html', 'terms.html', 'delete-account.html', '404.html']) {
  fs.copyFileSync(path.join(PUBLIC_DIR, f), path.join(fixture, f));
}
fs.writeFileSync(path.join(fixture, 'assets', 'index-abc.js'), 'console.log(1);');

process.env.NODE_ENV = 'production';
process.env.CLIENT_DIST = fixture;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-static-pages';

const { createApp } = await import('../src/app.js');
const { closeQueues } = await import('../src/queues/index.js');

let server;
let base;

before(async () => {
  if (skip) return;
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (skip) return;
  if (server) await new Promise((r) => server.close(r));
  await closeQueues(); // createApp() opens Bull Board producer queues → live Redis handles
  fs.rmSync(fixture, { recursive: true, force: true });
});

const get = (p, init) => fetch(`${base}${p}`, { redirect: 'manual', ...init });

test('the three legal pages are served at clean URLs, with no JavaScript at all', { skip }, async () => {
  for (const [p, marker] of [
    ['/privacy', 'Privacy Policy'],
    ['/terms', 'Terms of Service'],
    ['/delete-account', 'Delete your Doorline account'],
  ]) {
    const res = await get(p);
    assert.strictEqual(res.status, 200, p);
    assert.match(res.headers.get('content-type') || '', /text\/html/, p);
    const html = await res.text();
    assert.ok(html.includes(marker), `${p} carries its document text`);
    assert.doesNotMatch(html, /<script/i, `${p} must not ship a bundle or any script`);
  }
});

test('the served documents are the policy, not the SPA shell', { skip }, async () => {
  const html = await (await get('/privacy')).text();
  assert.ok(html.includes('We do not sell personal information'), 'real policy text');
  assert.ok(
    html.includes('<link rel="canonical" href="https://doorline.app/privacy" />'),
    'self-referential canonical — never the homepage’s'
  );
  assert.ok(!html.includes('<div id="root"'), 'not the app shell');
});

test('/privacy keeps Google Play’s #delete-account anchor in the raw HTML', { skip }, async () => {
  assert.match(await (await get('/privacy')).text(), /id="delete-account"/);
});

test('/privacy resolves with a trailing slash, odd casing, a query string, and to HEAD', { skip }, async () => {
  for (const p of ['/privacy/', '/Privacy', '/privacy?utm_source=play']) {
    assert.strictEqual((await get(p)).status, 200, p);
  }
  const head = await get('/privacy', { method: 'HEAD' });
  assert.strictEqual(head.status, 200);
  assert.match(head.headers.get('content-type') || '', /text\/html/);
});

test('the .html twins 301 to the clean, canonical URLs', { skip }, async () => {
  for (const [twin, clean] of [
    ['/privacy.html', '/privacy'],
    ['/terms.html', '/terms'],
    ['/delete-account.html', '/delete-account'],
  ]) {
    const res = await get(twin);
    assert.strictEqual(res.status, 301, twin);
    assert.strictEqual(res.headers.get('location'), clean, twin);
  }
});

test('unknown top-level paths return a real 404 — never a redirect to /', { skip }, async () => {
  for (const p of ['/nope', '/wp-admin', '/nope/deeper', '/.env']) {
    const res = await get(p);
    assert.strictEqual(res.status, 404, p);
    assert.match(res.headers.get('content-type') || '', /text\/html/, p);
    assert.match(await res.text(), /Page not found/, p);
  }
});

test('every known client route still gets the SPA shell with a 200', { skip }, async () => {
  for (const p of [
    '/', '/login', '/campaigns', '/campaigns/abc123/efforts/def456/passes',
    '/campaigns/abc123/exports', // the Export Center page
    '/r/tok3n', '/r/tok3n/reports/rep1', // emailed client-report links — must never 404
    '/dashboard/abc123', // back-compat redirect route
    '/help/voter-imports', '/super-admin/users', '/admin/duplicate-surveys', '/queues',
  ]) {
    const res = await get(p);
    assert.strictEqual(res.status, 200, p);
    assert.match(await res.text(), /<div id="root"/, p);
  }
});

test('unknown /api paths still get the JSON 404', { skip }, async () => {
  const res = await get('/api/definitely-not-a-route');
  assert.strictEqual(res.status, 404);
  assert.deepStrictEqual(await res.json(), { error: 'Not found' });
});

test('real assets are served; a missing hashed chunk 404s instead of returning HTML', { skip }, async () => {
  assert.strictEqual((await get('/assets/index-abc.js')).status, 200);
  // ErrorBoundary's stale-chunk reload guard was written for exactly this 404.
  assert.strictEqual((await get('/assets/index-stale.js')).status, 404);
});

// ── The committed documents themselves (the files a build ships verbatim).
test('the committed legal documents carry the load-bearing sentences and no scripts', { skip }, () => {
  const read = (f) => fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');

  const privacy = read('privacy.html');
  assert.match(privacy, /Doorline LLC/);
  assert.match(privacy, /We do not sell personal information/);
  assert.match(privacy, /Geocodio, which converts street addresses/);
  assert.match(privacy, /Expo, which delivers updates/);
  assert.match(privacy, /a password can never be removed from a link/);
  assert.match(privacy, /no longer directly identify you/);
  assert.match(privacy, /id="delete-account"/);
  assert.match(privacy, /<link rel="canonical" href="https:\/\/doorline\.app\/privacy" \/>/);
  assert.doesNotMatch(privacy, /<script/i);
  assert.doesNotMatch(privacy, /â/, 'no mojibake — em dashes and arrows must be real UTF-8');

  const terms = read('terms.html');
  assert.match(terms, /Terms of Service/);
  assert.match(terms, /State of Texas/);
  assert.match(terms, /<link rel="canonical" href="https:\/\/doorline\.app\/terms" \/>/);
  assert.doesNotMatch(terms, /<script/i);
  assert.doesNotMatch(terms, /â/);

  const del = read('delete-account.html');
  assert.match(del, /Profile → Delete account/);
  assert.match(del, /within 30 days/, 'the emailed-path timeframe Play favors');
  assert.match(del, /only administrator or the only billing administrator/);
  assert.match(del, /no longer directly identify you/);
  assert.match(del, /href="\/privacy"/);
  assert.doesNotMatch(del, /<script/i);
  assert.doesNotMatch(del, /â/);

  const nf = read('404.html');
  assert.match(nf, /name="robots" content="noindex"/);
  assert.doesNotMatch(nf, /<script/i);
});

test('every static page carries the brand chrome — logo, header nav, footer cross-links', { skip }, () => {
  const read = (f) => fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
  // The Doorline pin — the exact path from client/src/components/Logo.jsx. If the brand mark
  // changes there, change it here and in the four static pages together.
  const LOGO_PATH = 'M18 0 C8.06 0 0 8.06 0 18';
  for (const f of ['privacy.html', 'terms.html', 'delete-account.html', '404.html']) {
    const html = read(f);
    assert.ok(html.includes(LOGO_PATH), `${f}: logo mark present`);
    assert.match(html, /class="site-header"/, `${f}: header present`);
    assert.match(html, /class="signin" href="\/login"/, `${f}: Sign in`);
    assert.match(html, /class="site-footer"/, `${f}: footer present`);
    assert.match(html, /© 2026 Doorline LLC/, `${f}: copyright line`);
    // Cross-links: each page's footer must reach the other legal pages (its own entry renders
    // as unlinked text, so only require the two/three OTHER hrefs).
    for (const target of ['/privacy', '/terms', '/delete-account']) {
      const isSelf = f === `${target.slice(1)}.html`;
      if (!isSelf) assert.ok(html.includes(`href="${target}"`), `${f}: links ${target}`);
    }
  }
});
