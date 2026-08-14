// Where a kebab (⋮) popover should sit so it is ALWAYS fully on screen.
//
// Pure and viewport-injected so the placement rules are testable without a DOM — the cases that
// actually broke (a card in the second row, a long menu, a short window) are exactly the ones
// that are tedious to reproduce by hand and easy to regress.
//
// The rules, in order:
//   1. Prefer opening BELOW the button — the familiar direction.
//   2. Flip ABOVE when the menu doesn't fit below and there is more room above. This is the fix:
//      opening blindly downward is what let a second-row card's menu run off the bottom.
//   3. Clamp to the viewport on all four sides, so even a menu taller than the window pins to the
//      top margin instead of hanging off both ends.
//
// Horizontally, `align` picks which edge the menu hangs off — then every mode is clamped, so a
// trigger near either edge can't push the menu off-screen:
//   'end'   (default) right-aligned to the button — the kebab's natural anchor.
//   'start' left edges shared with the trigger — a menu under a wide row, e.g. the sidebar's
//           expanded account button, where right-aligning would float it off that column.
//   'after' beside the trigger rather than over it — the collapsed sidebar rail's flyout, where
//           both other modes would lay the menu on top of the 64px rail it came from.

export const GAP = 4; // breathing room between button and menu
export const MARGIN = 8; // minimum clearance from every viewport edge

export function resolveMenuPosition({ anchor, menu, viewport, align = 'end' }) {
  const roomBelow = viewport.height - anchor.bottom - GAP - MARGIN;
  const roomAbove = anchor.top - GAP - MARGIN;

  let top = anchor.bottom + GAP;
  let placement = 'below';
  if (menu.height > roomBelow && roomAbove > roomBelow) {
    top = anchor.top - GAP - menu.height;
    placement = 'above';
  }
  // max() last so it always wins: a menu taller than the viewport is pinned to the top margin
  // rather than pushed off the top by the min().
  top = Math.max(MARGIN, Math.min(top, viewport.height - MARGIN - menu.height));

  let left;
  if (align === 'after') left = anchor.right + GAP;
  else if (align === 'start') left = anchor.left;
  else left = anchor.right - menu.width;
  left = Math.max(MARGIN, Math.min(left, viewport.width - MARGIN - menu.width));

  return { top, left, placement };
}
