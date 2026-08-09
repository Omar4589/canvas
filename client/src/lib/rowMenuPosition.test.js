import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMenuPosition, GAP, MARGIN } from './rowMenuPosition.js';

// A 1250px-tall window like the screenshot that prompted this, and a menu the size the
// campaigns kebab actually renders (w-44 = 176px; ~28px per item + 10px padding).
const viewport = { width: 1400, height: 1250 };
const menuOf = (items) => ({ width: 176, height: items * 28 + 10 });
// A kebab button is ~28x28. `y` is its top edge.
const buttonAt = (x, y) => ({ top: y, bottom: y + 28, left: x, right: x + 28 });

test('a first-row card opens downward, right-aligned to the button', () => {
  const anchor = buttonAt(845, 1000);
  const menu = menuOf(2);
  const p = resolveMenuPosition({ anchor, menu, viewport });
  assert.equal(p.placement, 'below');
  assert.equal(p.top, anchor.bottom + GAP);
  assert.equal(p.left, anchor.right - menu.width);
});

test('a SECOND-ROW card flips above instead of running off the bottom — the reported bug', () => {
  // Button low in the window, with a 5-item admin menu that cannot fit beneath it.
  const anchor = buttonAt(845, 1150);
  const menu = menuOf(5);
  const p = resolveMenuPosition({ anchor, menu, viewport });
  assert.equal(p.placement, 'above');
  assert.equal(p.top, anchor.top - GAP - menu.height);
  assert.ok(p.top >= MARGIN, 'still clear of the top edge');
  assert.ok(p.top + menu.height <= viewport.height - MARGIN, 'fully on screen');
});

test('every button position keeps the menu fully on screen, for every menu length', () => {
  for (let items = 2; items <= 6; items += 1) {
    const menu = menuOf(items);
    for (let y = 0; y <= viewport.height - 28; y += 7) {
      const anchor = buttonAt(845, y);
      const { top, left } = resolveMenuPosition({ anchor, menu, viewport });
      assert.ok(top >= MARGIN, `items=${items} y=${y}: off the top (${top})`);
      assert.ok(
        top + menu.height <= viewport.height - MARGIN,
        `items=${items} y=${y}: off the bottom (${top + menu.height})`
      );
      assert.ok(left >= MARGIN, `items=${items} y=${y}: off the left`);
      assert.ok(left + menu.width <= viewport.width - MARGIN, `items=${items} y=${y}: off the right`);
    }
  }
});

test('a kebab near the left edge is clamped instead of pushed off-screen', () => {
  const p = resolveMenuPosition({ anchor: buttonAt(4, 300), menu: menuOf(4), viewport });
  assert.equal(p.left, MARGIN, 'right-aligning would have put it at a negative left');
});

test('a kebab near the right edge stays inside the margin', () => {
  const anchor = buttonAt(viewport.width - 30, 300);
  const menu = menuOf(4);
  const p = resolveMenuPosition({ anchor, menu, viewport });
  assert.ok(p.left + menu.width <= viewport.width - MARGIN);
});

test('a menu taller than the window pins to the top margin, not off both ends', () => {
  const shortWindow = { width: 1400, height: 200 };
  const menu = menuOf(6); // 178px tall — taller than 200 - 2*8
  const p = resolveMenuPosition({ anchor: buttonAt(845, 150), menu, viewport: shortWindow });
  assert.equal(p.top, MARGIN, 'the max() has to win over the min() here');
});

test('ties go downward — an exact fit below is not a reason to flip', () => {
  const menu = menuOf(3);
  // Place the button so the room below is exactly the menu height.
  const bottom = viewport.height - MARGIN - GAP - menu.height;
  const anchor = { top: bottom - 28, bottom, left: 845, right: 873 };
  const p = resolveMenuPosition({ anchor, menu, viewport });
  assert.equal(p.placement, 'below');
});
