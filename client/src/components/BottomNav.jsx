import { useState } from 'react';
import { NavLink, useMatch } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ORG_NAV, CAMPAIGN_NAV, SUPER_NAV } from './navItems.js';
import { navIcon } from './navIcons.jsx';
import OrgSwitcher from './OrgSwitcher.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import Logo from './Logo.jsx';

// Two-level mobile nav, mirroring the desktop sidebar (Layout.jsx): at the top level
// it shows org items; drilled into a campaign (/campaigns/:id/*) it swaps to the
// campaign nav with a "‹ All campaigns" exit in the More sheet. A small set of items
// get a bottom-bar tab (keyed by route path in org mode, by slug in campaign mode);
// the rest live in the sheet.
const ORG_PRIMARY = ['/admin', '/campaigns', '/users'];
const CAMPAIGN_PRIMARY = ['', 'map'];

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
  const { user, logout, isSuperAdmin, isLead } = useAuth();
  const [open, setOpen] = useState(false);
  const campaignMatch = useMatch('/campaigns/:campaignId/*');
  const inCampaign = !!campaignMatch;
  const campaignId = campaignMatch?.params.campaignId || '';

  // Mock-GPS nudge: same cached query the desktop sidebar uses (shared cache entry — no
  // extra fetch). Drives the red dot on the More tab + the pill on the Audit sheet item.
  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
    enabled: inCampaign,
  });
  const openMockFlags =
    (campaignsQ.data?.campaigns || []).find((c) => String(c._id) === String(campaignId))?.openMockFlags || 0;

  function close() {
    setOpen(false);
  }

  // Resolve the tab + sheet item lists for the current context.
  let tabs;
  let moreItems;
  if (inCampaign) {
    const toItem = (n) => ({
      key: n.slug || 'home',
      to: `/campaigns/${campaignId}${n.slug ? '/' + n.slug : ''}`,
      label: n.label,
      icon: n.icon,
      end: !n.slug,
    });
    const all = CAMPAIGN_NAV.map(toItem);
    tabs = CAMPAIGN_NAV.filter((n) => CAMPAIGN_PRIMARY.includes(n.slug)).map(toItem);
    moreItems = all.filter((it) => !tabs.some((t) => t.key === it.key));
  } else {
    // A team lead only sees the campaign-scoped top-level items (Campaigns).
    const orgNav = isLead ? ORG_NAV.filter((n) => n.leadVisible) : ORG_NAV;
    const toItem = (n) => ({ key: n.to, to: n.to, label: n.label, icon: n.to, end: n.end });
    const all = orgNav.map(toItem);
    tabs = orgNav.filter((n) => ORG_PRIMARY.includes(n.to)).map(toItem);
    moreItems = all.filter((it) => !tabs.some((t) => t.key === it.key));
  }

  return (
    <>
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 flex border-t border-border bg-card py-1">
        {tabs.map((it) => {
          const Icon = navIcon(it.icon);
          return (
            <NavLink key={it.key} to={it.to} end={it.end} className={tabClass}>
              <Icon />
              <span>{it.label}</span>
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
          <span className="relative">
            <IconMore />
            {openMockFlags > 0 && (
              <span className="absolute -right-1.5 -top-0.5 h-2 w-2 rounded-full bg-danger" />
            )}
          </span>
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

            {inCampaign && (
              <NavLink to="/campaigns" end className={sheetLinkClass} onClick={close}>
                ‹ All campaigns
              </NavLink>
            )}

            <div className="space-y-1">
              {moreItems.map((it) => (
                <NavLink key={it.key} to={it.to} end={it.end} className={sheetLinkClass} onClick={close}>
                  {it.key === 'audit' && openMockFlags > 0 ? (
                    <span className="flex items-center">
                      {it.label}
                      <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold leading-none text-white ring-1 ring-white/60">
                        {openMockFlags}
                      </span>
                    </span>
                  ) : (
                    it.label
                  )}
                </NavLink>
              ))}
            </div>

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
