import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdownToBlocks } from './markdownBlocks.js';

// The help block parser's list rule. A long bullet wraps onto an INDENTED second line in the
// source; that line belongs to the bullet, as in Markdown. Before this rule it rendered as a stray
// paragraph after the list — on 24 articles in both Help Centers.

const plain = (spans) => spans.map((s) => s.text).join('');

test('a wrapped bullet is one item', () => {
  const blocks = markdownToBlocks('- **Undo** puts every survey back,\n  except one someone changed since.\n- Second item');
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].items.map(plain), ['Undo puts every survey back, except one someone changed since.', 'Second item']);
});

test('a wrapped numbered step is one item', () => {
  const blocks = markdownToBlocks('1. Filter Door Outcomes\n   to that canvasser.\n2. Select them all.');
  assert.equal(blocks[0].ordered, true);
  assert.deepEqual(blocks[0].items.map(plain), ['Filter Door Outcomes to that canvasser.', 'Select them all.']);
});

test('an unindented line, or one after a blank line, is still its own paragraph', () => {
  const tight = markdownToBlocks('- one\n- two\nA paragraph right after.');
  assert.deepEqual(tight.map((b) => b.type), ['list', 'paragraph'], 'no lazy continuation');
  const spaced = markdownToBlocks('- one\n\n  Indented, but after a blank line.');
  assert.deepEqual(spaced.map((b) => b.type), ['list', 'paragraph']);
});

test('an indented marker is still a new item, and the other list kind still ends the list', () => {
  assert.deepEqual(markdownToBlocks('- one\n  - two').map((b) => b.items.map(plain)), [['one', 'two']]);
  assert.deepEqual(markdownToBlocks('- one\n1. first').map((b) => b.type), ['list', 'list']);
});

test('no help article renders the second line of a bullet as its own paragraph', () => {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../content/help');
  const strays = [];
  for (const dir of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const f of readdirSync(join(root, dir.name)).filter((n) => n.endsWith('.md') && !n.startsWith('_'))) {
      const src = readFileSync(join(root, dir.name, f), 'utf8');
      const paragraphs = new Set(markdownToBlocks(src).filter((b) => b.type === 'paragraph').map((b) => plain(b.spans)));
      // Every indented line straight under a list line (no blank between) must not open a paragraph.
      const lines = src.split('\n');
      let inList = false;
      for (const line of lines) {
        if (/^\s*([-*]|\d+\.)\s+/.test(line)) inList = true;
        else if (!line.trim() || !/^\s+\S/.test(line)) inList = false;
        else if (inList && [...paragraphs].some((p) => p.startsWith(line.trim().replace(/[*_`]/g, '').slice(0, 30)))) {
          strays.push(`${dir.name}/${f}: ${line.trim().slice(0, 60)}`);
        }
      }
    }
  }
  assert.deepEqual(strays, []);
});
