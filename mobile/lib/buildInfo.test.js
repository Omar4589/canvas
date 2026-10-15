import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLine } from './buildInfo.js';

const fmt = (d) => d.toISOString();

test('an embedded launch says so, with runtime and channel', () => {
  assert.equal(
    buildLine({ runtimeVersion: 'efdcd132', channel: 'production', isEmbeddedLaunch: true, updateId: 'abc' }, fmt),
    'vefdcd132 · production · embedded build'
  );
});

test('no update id reads as embedded too', () => {
  assert.equal(buildLine({ runtimeVersion: 'r1' }, fmt), 'vr1 · embedded build');
});

test('an OTA update shows its short id and when it was published', () => {
  assert.equal(
    buildLine(
      { runtimeVersion: 'efdcd132', channel: 'staging', updateId: '01a12c5c-1111-2222', createdAt: '2026-10-11T20:07:18.000Z' },
      fmt
    ),
    'vefdcd132 · staging · update 01a12c5c · 2026-10-11T20:07:18.000Z'
  );
});

test('missing constants degrade to a dash, never a crash', () => {
  assert.equal(buildLine(undefined, fmt), 'v— · embedded build');
  assert.equal(buildLine({ updateId: 'abcdef123456' }, fmt), 'v— · update abcdef12');
});
