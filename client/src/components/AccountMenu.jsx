import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../lib/useTheme.js';
import { resolveMenuPosition } from '../lib/rowMenuPosition.js';
import { Avatar } from './ui/Avatar.jsx';
import { Tooltip } from './ui/Popover.jsx';
import { IconChevronUpDown, IconHelp, IconMoon, IconSignOut, IconSun, IconUser } from './ui/icons.jsx';

// The sidebar's whole footer: one account row that opens Profile / Help / theme / Sign out in a
// floating menu. Those four used to be stacked rows of their own, which spent ~140px of sidebar on
// controls you touch weekly while an 18-item campaign nav scrolled above them.
//
// Positioning is the shared resolveMenuPosition (lib/rowMenuPosition.js) that RowMenu uses — it
// already flips ABOVE when there's no room below (which, for a row pinned to the bottom of the
// viewport, is always) and clamps to all four edges. `align` is the only part specific to here:
// beside the rail when collapsed, sharing the sidebar's left edge when expanded. ui/Popover's
// Popover is not reusable for this — it hard-codes `top: r.bottom + 6` and cannot open upward.
export default function AccountMenu({ collapsed }) {
  const { user, logout } = useAuth();
  const { dark, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(null); // the trigger's rect at open time
  const [pos, setPos] = useState(null); // resolved { top, left }
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const close = () => {
    setAnchor(null);
    setPos(null);
  };
  const toggle = () => (anchor ? close() : setAnchor(btnRef.current.getBoundingClientRect()));

  // useLayoutEffect so the corrected position is the first one painted — the provisional (hidden)
  // render the measurement needs never reaches the screen.
  useLayoutEffect(() => {
    if (!anchor || !menuRef.current) return;
    const { offsetHeight, offsetWidth } = menuRef.current;
    setPos(
      resolveMenuPosition({
        anchor,
        menu: { width: offsetWidth, height: offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        align: collapsed ? 'after' : 'start',
      })
    );
  }, [anchor, collapsed]);

  // Fixed-positioned from a viewport rect, so any scroll or resize detaches the menu from its
  // button. Close instead of chasing — same call RowMenu makes. Capture phase so a scroll inside
  // the nav's own overflow container counts, not just the window's.
  useEffect(() => {
    if (!anchor) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      close();
      btnRef.current?.focus(); // Esc should land you back on the trigger, not nowhere
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor]);

  const go = (to) => {
    close();
    navigate(to);
  };

  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  const open = !!anchor;

  const trigger = (
    <button
      ref={btnRef}
      type="button"
      onClick={toggle}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={collapsed ? `Account — ${name}` : undefined}
      className={[
        'flex items-center rounded-md text-sm transition-colors hover:bg-sunken',
        // The rail geometry, matched to navClass in Layout: a full-width 48px pill, so the
        // avatar sits on the same center line as every nav glyph above it.
        collapsed ? 'w-full justify-center px-2 py-2' : 'w-full gap-2 px-3 py-2 text-left',
        open ? 'bg-sunken' : '',
      ].join(' ')}
    >
      <Avatar user={user} size={collapsed ? 'sm' : 'md'} />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-fg">{name}</span>
            <span className="block truncate text-xs text-fg-muted">{user?.email}</span>
          </span>
          <span className="shrink-0 text-fg-subtle">
            <IconChevronUpDown size={16} />
          </span>
        </>
      )}
    </button>
  );

  return (
    <>
      {collapsed ? (
        <Tooltip label={name || 'Account'} placement="right" block>
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            ref={menuRef}
            role="menu"
            aria-label="Account"
            style={{
              position: 'fixed',
              top: pos ? pos.top : 0,
              left: pos ? pos.left : 0,
              // Hidden for the one provisional render the measurement needs. `visibility` rather
              // than `display` — a display:none element has no size to measure.
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="z-50 w-56 animate-pop-in overflow-hidden rounded-lg border border-border bg-raised shadow-popover"
          >
            {/* Collapsed, the rail shows only an avatar — this header is the one place the name and
                email are readable at all. */}
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Avatar user={user} size="md" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-fg">{name}</span>
                <span className="block truncate text-xs text-fg-muted">{user?.email}</span>
              </span>
            </div>

            <div className="py-1">
              <MenuItem icon={IconUser} label="Profile" onClick={() => go('/profile')} />
              <MenuItem icon={IconHelp} label="Help" onClick={() => go('/help')} />
              {/* Stays open on purpose: flipping the theme and flipping straight back is the
                  normal way this control gets used, and closing would cost a reopen each time. */}
              <MenuItem
                icon={dark ? IconSun : IconMoon}
                label={dark ? 'Light mode' : 'Dark mode'}
                onClick={toggleTheme}
              />
            </div>

            <div className="border-t border-border py-1">
              <MenuItem
                icon={IconSignOut}
                label="Sign out"
                onClick={() => {
                  close();
                  logout();
                }}
                className="text-brand-accent hover:bg-brand-tint hover:text-brand-hover"
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function MenuItem({ icon: Icon, label, onClick, className = '' }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-fg-muted transition-colors hover:bg-sunken hover:text-fg ${className}`}
    >
      <Icon size={20} />
      <span>{label}</span>
    </button>
  );
}
