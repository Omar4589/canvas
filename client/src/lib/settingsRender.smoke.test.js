import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke tests for the Settings page (docs/PROPOSAL_PEOPLE_PAGES.md §C): the header, the
// loading and error states, and the Automatic pause card's "Who gets the email" — only the people
// chosen, each with Remove, a stale pick named and marked, the search box (gone when read-only,
// disabled at 25). renderToString executes each component body, so a hook or branch that throws on a
// real payload fails here. The picker's rules are lib/recipientPicker.js (recipientPicker.test.js).

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(here, '../../.smoke-settings-'));
after(() => rmSync(dir, { recursive: true, force: true }));

let built = 0;
const build = async (entry) => {
  const name = `entry${++built}`;
  writeFileSync(join(dir, `${name}.jsx`), entry);
  const out = join(dir, `${name}.mjs`);
  await esbuild.build({
    entryPoints: [join(dir, `${name}.jsx`)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    jsx: 'automatic',
    logLevel: 'silent',
    packages: 'external',
  });
  return import(pathToFileURL(out).href);
};
const src = (p) => join(here, '..', p);

const text = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
const buttons = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], label: text(m[2]).trim() }));

const SETTINGS = {
  enabled: true,
  billingAdmins: true,
  alertUserIds: ['u1', 'gone'],
  chosen: [
    { userId: 'u1', name: 'Pat Lee', role: 'admin', eligible: true },
    { userId: 'gone', name: 'Jo Park', role: 'canvasser', eligible: false },
  ],
  eligible: [
    { userId: 'u1', name: 'Pat Lee', role: 'admin', billingAdmin: true },
    { userId: 'u2', name: 'Riley Shaw', role: 'lead', billingAdmin: false },
  ],
  live: true,
  canEdit: true,
  openPauses: 0,
  changedAt: '2026-10-20T00:00:00Z',
  changedByName: 'Riley Shaw',
};

const entry = () => `
  import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { MemoryRouter } from 'react-router-dom';
  import SettingsPage from '${src('pages/SettingsPage.jsx')}';
  globalThis.fetch = () => new Promise(() => {});
  export const render = (settings, { error = false } = {}) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } } });
    if (settings) qc.setQueryData(['admin', 'pace-pauses', 'settings'], settings);
    if (error) {
      qc.getQueryCache().build(qc, { queryKey: ['admin', 'pace-pauses', 'settings'] })
        .setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle', errorUpdatedAt: Date.now() });
    }
    return renderToString(<QueryClientProvider client={qc}><MemoryRouter><SettingsPage /></MemoryRouter></QueryClientProvider>);
  };`;

test('the page: its header, a skeleton while loading, and Couldn’t load — Retry', async () => {
  const { render } = await build(entry());
  const loading = render(null);
  assert.match(text(loading), /Settings Automatic pause, for every campaign in your organization\./);
  assert.match(loading, /aria-busy="true"/, 'the skeleton');
  const failed = render(null, { error: true });
  assert.match(text(failed), /Couldn’t load — Retry/);
  assert.ok(buttons(failed).some((b) => b.label === 'Retry'));
});

test('a billing admin: the people chosen with Remove, the stale pick named, and the search box', async () => {
  const { render } = await build(entry());
  const html = render(SETTINGS);
  const t = text(html);
  assert.match(t, /Billing admins \(always\) Everyone with billing access, including anyone given it later/);
  assert.match(t, /Also email Pat Lee Org admin · billing admin/);
  assert.match(t, /Jo Park Not emailed: no longer an admin or team lead/, 'named, and marked');
  assert.equal(buttons(html).filter((b) => b.label === 'Remove').length, 2, 'Remove on each row, stale one included');
  assert.match(html, /role="combobox"/, 'Add a person');
  assert.doesNotMatch(html, /role="combobox"[^>]*disabled/);
  assert.doesNotMatch(t, /Riley Shaw Team lead/, 'nobody unchosen is listed — the search finds them');
  assert.match(t, /Last changed by Riley Shaw/);
  assert.match(t, /isn't running|a team lead may be your client/);
});

test('read-only for an admin without billing access: no Remove, no search', async () => {
  const { render } = await build(entry());
  const html = render({ ...SETTINGS, canEdit: false });
  assert.equal(buttons(html).filter((b) => b.label === 'Remove').length, 0);
  assert.doesNotMatch(html, /role="combobox"/);
  assert.match(text(html), /Pat Lee/, 'the rows still show');
  assert.match(text(html), /Only a billing admin can change this\./);
});

test('the search disables at 25 people', async () => {
  const { render } = await build(entry());
  const ids = Array.from({ length: 25 }, (_, i) => `p${i}`);
  const people = ids.map((id) => ({ userId: id, name: `Person ${id}`, role: 'lead', billingAdmin: false }));
  const html = render({ ...SETTINGS, alertUserIds: ids, chosen: people.map((p) => ({ ...p, eligible: true })), eligible: people });
  assert.match(html, /role="combobox"[^>]*disabled=""/);
  assert.match(text(html), /That’s the limit of 25 people\. Remove someone to add another\./);
});
