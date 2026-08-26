import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// The shared Modal's SCROLL CONTRACT, pinned by rendering it.
//
// Overlay locks body scroll, so for a card taller than the viewport there is no scroll anywhere:
// the overflow is simply unreachable. On a long confirm dialog that meant the footer's own
// Cancel and confirm buttons sat off-screen — reported 2026-08-26 against the Unknock dialog,
// where selecting a decent number of entries made the review step impossible to act on. The fix
// is Drawer's min-h-0 chain: a height-capped flex column whose BODY scrolls while header and
// footer stay pinned. Every one of the app's 25 Modal call sites rides this, so it is asserted
// on the rendered markup rather than trusted.
//
// Overlay is stubbed because it portals to document.body, which the server renderer refuses —
// the contract under test is the card/body/footer chain inside it, and the stub keeps the panel
// wrapper so the cap arithmetic can be checked against it.

const here = fileURLToPath(new URL('.', import.meta.url));
// Inside the client tree on purpose: dependencies stay external to the bundle, so node resolves
// react/react-dom from the bundle's own location (the doorOutcomesRender smoke test's rule).
const dir = mkdtempSync(join(here, '../../.smoke-modal-'));

const build = async (entry) => {
  writeFileSync(
    join(dir, 'overlayStub.jsx'),
    `export default function Overlay({ className = '', children }) {
       return <div data-testid="panel" className={className}>{children}</div>;
     }`
  );
  writeFileSync(join(dir, 'entry.jsx'), entry);
  const out = join(dir, 'bundle.mjs');
  await esbuild.build({
    entryPoints: [join(dir, 'entry.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    jsx: 'automatic',
    logLevel: 'silent',
    packages: 'external',
    plugins: [
      {
        name: 'stub-overlay',
        setup(b) {
          // esbuild matches the import specifier as WRITTEN — Modal imports './Overlay.jsx'.
          b.onResolve({ filter: /(^|\/)Overlay\.jsx$/ }, () => ({ path: join(dir, 'overlayStub.jsx') }));
        },
      },
    ],
  });
  const mod = await import(`${pathToFileURL(out).href}?t=${entry.length}`);
  return mod.html;
};

const render = (body, extra = '') => `
  import React from 'react';
  import { renderToString } from 'react-dom/server';
  import Modal from '${join(here, '../components/ui/Modal.jsx')}';
  export const html = renderToString(
    <Modal onClose={() => {}} title="Unknock 15 entries" subtitle="Removes them from the record"${extra}>
      ${body}
    </Modal>
  );`;

// The class list of the element carrying a marker class, from rendered markup.
const classesOf = (html, marker) => {
  const m = html.match(new RegExp(`class="([^"]*\\b${marker}\\b[^"]*)"`));
  return m ? m[1].split(/\s+/) : null;
};

test('a Modal caps its height and scrolls its body, so long content is always reachable', async () => {
  try {
    const html = await build(render('<p>body copy</p>', ' footer={<button type="button">Unknock entries</button>}'));

    // The card: a flex column that can never outgrow the viewport.
    const card = classesOf(html, 'animate-pop-in');
    assert.ok(card, 'the card should render');
    assert.ok(card.includes('flex') && card.includes('flex-col'), 'card is a flex column');
    assert.ok(
      card.some((c) => c.startsWith('max-h-')),
      'card is height-capped — without it the overflow is unreachable, since Overlay locks body scroll'
    );

    // The body: the scroll region, with the min-h-0 chain that lets it actually shrink.
    const body = classesOf(html, 'overflow-y-auto');
    assert.ok(body, 'the body should be a scroll region');
    assert.ok(body.includes('min-h-0'), 'min-h-0 — a flex item defaults to min-height:auto and refuses to shrink');
    assert.ok(body.includes('flex-1'), 'flex-1 — the body takes the leftover height, not the header/footer');

    // The footer: pinned, because it holds the dialog's own action buttons.
    assert.match(html, /Unknock entries/, 'the footer rendered');
    const footer = classesOf(html, 'border-t');
    assert.ok(footer?.includes('shrink-0'), 'the footer must not be shrunk or scrolled away — it holds the actions');

    // The header: pinned too, so the title stays with the content being scrolled.
    const header = classesOf(html, 'border-b');
    assert.ok(header?.includes('shrink-0'), 'the header stays put while the body scrolls');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
