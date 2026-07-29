import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEB_SEGMENTS } from '../src/webRoutes.js';

// The server's SPA-fallback allowlist is a hand-maintained mirror of client/src/App.jsx.
// This is the gate that keeps them honest: add a route to App.jsx without touching
// webRoutes.js and the new page 404s — silently, and only in production. Runs under plain
// `npm test` (no DB, no app boot).
const APP_JSX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../client/src/App.jsx'
);

// Served by explicit Express routes ahead of the fallback, so they are deliberately NOT in
// WEB_SEGMENTS and deliberately NOT React routes. If someone re-adds them to App.jsx, the
// bidirectional check below fails and forces a decision.
const STATIC_PAGE_SEGMENTS = new Set(['privacy', 'terms', 'delete-account', 'app']);

test('WEB_SEGMENTS exactly mirrors the first segments of App.jsx routes', () => {
  const src = fs.readFileSync(APP_JSX, 'utf8');
  // `path` is the attribute on <Route>; layout routes (<Route element={…}>) have none and are
  // correctly skipped because [^>] cannot cross the '>' that closes their opening tag.
  const paths = [...src.matchAll(/<Route[^>]*\spath="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(paths.length > 30, `parsed only ${paths.length} routes from App.jsx — did the regex break?`);

  const derived = new Set();
  for (const p of paths) {
    if (p === '*') continue; // the client-side catch-all → NotFoundPage
    assert.ok(p.startsWith('/'), `route "${p}" is relative; this gate assumes absolute paths`);
    const seg = p.split('/')[1] ?? '';
    assert.ok(!seg.startsWith(':'), `route "${p}" has a DYNAMIC first segment — it cannot be allowlisted`);
    assert.ok(
      !STATIC_PAGE_SEGMENTS.has(seg),
      `route "${p}" collides with a static legal page — those are Express-served documents, not React routes`
    );
    derived.add(seg);
  }

  const missing = [...derived].filter((s) => !WEB_SEGMENTS.has(s));
  const stale = [...WEB_SEGMENTS].filter((s) => !derived.has(s));
  assert.deepStrictEqual(
    { missing, stale },
    { missing: [], stale: [] },
    'server/src/webRoutes.js is out of sync with client/src/App.jsx.\n' +
      `  missing → these App.jsx routes would 404 in production: ${missing.join(', ') || '(none)'}\n` +
      `  stale   → these segments no longer exist in App.jsx: ${stale.join(', ') || '(none)'}`
  );
});
