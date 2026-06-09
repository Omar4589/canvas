import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { NAV, SUPER_NAV, NAV_GROUPS } from './navItems.js';
import { navIcon } from './navIcons.jsx';
import OrgSwitcher from './OrgSwitcher.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import Logo from './Logo.jsx';

// Primary tabs vs. the "More" sheet are both derived from NAV (single source of
// truth): items flagged `primary` are tabs, the rest go in the sheet, clustered by
// workflow phase (NAV_GROUPS) so the sheet mirrors the desktop sidebar.
const primaryItems = NAV.filter((n) => n.primary);
const ungroupedMore = NAV.filter((n) => !n.primary && !n.group);

function IconMore() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function tabClass({ isActive }) {
  return [
    'flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-medium',
    isActive ? 'text-brand-accent' : 'text-fg-muted',
  ].join(' ');
}

function sheetLinkClass({ isActive }) {
  return [
    'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-brand-600 text-white shadow-sm'
      : 'text-fg-muted hover:bg-brand-tint hover:text-brand-accent',
  ].join(' ');
}

export default function BottomNav() {
  const { user, logout, isSuperAdmin } = useAuth();
  const [open, setOpen] = useState(false);

  function close() {
    setOpen(false);
  }

  return (
    <>
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 flex border-t border-border bg-card py-1">
        {primaryItems.map((n) => {
          const Icon = navIcon(n.to);
          return (
            <NavLink key={n.to} to={n.to} end={n.end} className={tabClass}>
              <Icon />
              <span>{n.label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={[
            'flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-medium',
            open ? 'text-brand-accent' : 'text-fg-muted',
          ].join(' ')}
        >
          <IconMore />
          <span>More</span>
        </button>
      </nav>

      {open && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-overlay/40" onClick={close} aria-hidden="true" />
          <div className="absolute bottom-0 inset-x-0 max-h-[80vh] overflow-auto rounded-t-2xl bg-card p-4 pb-20">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Logo size={22} />
                <span className="text-sm font-semibold text-fg-muted">Menu</span>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close menu"
                className="rounded-md p-1 text-fg-muted hover:bg-sunken"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {ungroupedMore.length > 0 && (
              <div className="space-y-1">
                {ungroupedMore.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end} className={sheetLinkClass} onClick={close}>
                    {n.label}
                  </NavLink>
                ))}
              </div>
            )}

            {NAV_GROUPS.map((group) => {
              const items = NAV.filter((n) => !n.primary && n.group === group);
              if (!items.length) return null;
              return (
                <div key={group}>
                  <div className="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
                    {group}
                  </div>
                  <div className="space-y-1">
                    {items.map((n) => (
                      <NavLink key={n.to} to={n.to} end={n.end} className={sheetLinkClass} onClick={close}>
                        {n.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              );
            })}

            {isSuperAdmin && (
              <>
                <div className="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
                  Platform
                </div>
                <div className="space-y-1">
                  {SUPER_NAV.map((n) => (
                    <NavLink key={n.to} to={n.to} className={sheetLinkClass} onClick={close}>
                      {n.label}
                    </NavLink>
                  ))}
                </div>
              </>
            )}

            <div className="mt-4">
              <OrgSwitcher />
            </div>

            <div className="mt-2 border-t border-border pt-4">
              <div className="truncate text-sm font-medium text-fg">
                {user?.firstName} {user?.lastName}
              </div>
              <div className="truncate text-xs text-fg-muted">{user?.email}</div>
              <button
                onClick={() => {
                  close();
                  logout();
                }}
                className="mt-2 text-xs font-semibold text-brand-accent hover:text-brand-accent"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
