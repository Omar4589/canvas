import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke test for the shared Voter-ID column picker: both forms render, the matched column is
// the selected one, and the undetected form carries the Match column button. The three upload pages
// have no client tests; this pins the one control they share.

const here = fileURLToPath(new URL('.', import.meta.url));

const render = async (dir, name, jsx) => {
  writeFileSync(
    join(dir, `${name}.jsx`),
    `import React from 'react';
     import { renderToString } from 'react-dom/server';
     import IdColumnPicker from '${join(here, '../components/IdColumnPicker.jsx')}';
     export const html = renderToString(${jsx});`
  );
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
  const { html } = await import(pathToFileURL(out).href);
  return html;
};

test('the inline picker offers every column with the matched one selected', async () => {
  const dir = mkdtempSync(join(here, '../../.smoke-picker-'));
  try {
    const html = await render(dir, 'inline', `<IdColumnPicker columns={['LALVOTERID', 'Voters_StateVoterID', 'City']} value="Voters_StateVoterID" onChange={() => {}} />`);
    assert.match(html, /Matched on column/);
    assert.match(html, /<option value="LALVOTERID">LALVOTERID<\/option>/);
    assert.match(html, /<option value="Voters_StateVoterID" selected="">Voters_StateVoterID<\/option>/);
    assert.doesNotMatch(html, /Match column/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the undetected form asks for a column and offers Match column', async () => {
  const dir = mkdtempSync(join(here, '../../.smoke-picker-'));
  try {
    const html = await render(dir, 'undetected', `<IdColumnPicker undetected columns={['A', 'B']} value="" onChange={() => {}} onMatch={() => {}} />`);
    assert.match(html, /Couldn&#x27;t find a Voter ID column/);
    assert.match(html, /Choose column/);
    assert.match(html, /Match column/);
    assert.match(html, /disabled=""/, 'nothing chosen yet, so Match column is disabled');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
