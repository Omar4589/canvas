import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../lib/useTheme.js';
import Logo, { LogoMark } from './Logo.jsx';
import { ORG_NAV, CAMPAIGN_NAV, SUPER_NAV } from './navItems.js';
import { navIcon, IconSignOut, IconChevron, IconHelp } from './navIcons.jsx';
import { IconSun, IconMoon } from './ui/icons.jsx';
import IconButton from './ui/IconButton.jsx';
import OrgSwitcher from './OrgSwitcher.jsx';
import BottomNav from './BottomNav.jsx';
import AddedToOrgBanner from './AddedToOrgBanner.jsx';
import BillingBanner from './BillingBanner.jsx';

function navClass(collapsed) {
  return ({ isActive }) =>
    [
      'flex items-center gap-3 rounded-md text-sm font-medium transition-colors',
      collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2',
      isActive
        ? 'bg-brand-600 text-white shadow-card'
        : 'text-fg-muted hover:bg-brand-tint hover:text-brand-tint-fg',
    ].join(' ');
}

function NavItem({ n, collapsed }) {
  const Icon = navIcon(n.to);
  return (
    <NavLink
      to={n.to}
      end={n.end}
      title={collapsed ? n.label : undefined}
      className={navClass(collapsed)}
    >
      <Icon size={20} />
      {!collapsed && <span>{n.label}</span>}
    </NavLink>
  );
}

const GROUP_HEADER = 'mt-3 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle';

// Lazy pages suspend on first visit while their JS chunk loads. This fallback lives INSIDE the
// sidebar shell (below), so only the content area shows it — the sidebar stays put instead of the
// whole app blanking to the top-level route fallback.
function ContentFallback() {
  return (
    <div className="flex items-center justify-center py-16">
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-brand-600"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}

function ThemeToggle({ collapsed, dark, toggle }) {
  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={[
        'flex items-center gap-3 rounded-md text-sm font-medium text-fg-muted transition-colors hover:bg-sunken hover:text-fg',
        collapsed ? 'justify-center p-2' : 'w-full px-3 py-2',
      ].join(' ')}
    >
      {dark ? <IconSun /> : <IconMoon />}
      {!collapsed && <span>{dark ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  );
}

export default function Layout() {
  const { user, logout, isSuperAdmin, isLead, canViewBilling } = useAuth();
  // A team lead is a campaign-scoped admin: the top-level nav collapses to the items
  // they can use (Campaigns). The campaign drill-in nav stays full — inside a granted
  // campaign a lead does everything an admin does.
  const orgNav = (isLead ? ORG_NAV.filter((n) => n.leadVisible) : ORG_NAV)
    // Billing is visible only to super admins + org admins granted billing access.
    .filter((n) => n.to !== '/billing' || canViewBilling);
  const { dark, toggle: toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  // Campaign drill-in: when the URL is /campaigns/:campaignId(/...), the sidebar shows the
  // campaign-scoped nav instead of the org nav. The splat is the current screen slug.
  const campaignMatch = useMatch('/campaigns/:campaignId/*');
  const inCampaign = !!campaignMatch;
  const campaignId = campaignMatch?.params.campaignId || '';
  const currentSlug = campaignMatch?.params['*'] || '';
  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
    enabled: inCampaign,
  });
  const campaigns = campaignsQ.data?.campaigns || [];
  const currentCampaign = campaigns.find((c) => String(c._id) === String(campaignId));

  const isFullBleed =
    location.pathname.endsWith('/map') || location.pathname.endsWith('/turfs') || location.pathname === '/queues';

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebarCollapsed') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // The static index.html title is marketing copy for the public landing page;
  // reset it to the console title once we're inside the authenticated app.
  useEffect(() => {
    document.title = 'Doorline Admin';
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <aside
        className={[
          'hidden md:flex flex-col border-r border-border bg-card py-5 transition-all duration-200',
          collapsed ? 'w-16 px-2' : 'w-60 px-4',
        ].join(' ')}
      >
        <div
          className={[
            'shrink-0',
            collapsed ? 'mb-4 flex flex-col items-center gap-2' : 'mb-1 flex items-center justify-between px-1',
          ].join(' ')}
        >
          {collapsed ? <LogoMark size={26} /> : <Logo size={26} />}
          <IconButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            variant="subtle"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
          >
            <span className={collapsed ? 'block rotate-180' : 'block'}>
              <IconChevron />
            </span>
          </IconButton>
        </div>

        {!collapsed && (
          <div className="mb-4 px-1 text-xs text-fg-muted shrink-0">
            Admin console{isSuperAdmin && <span className="ml-1 text-brand-accent">· super</span>}
            {isLead && <span className="ml-1 text-brand-accent">· team lead</span>}
          </div>
        )}

        {!collapsed && (
          <div className="shrink-0">
            <OrgSwitcher />
          </div>
        )}

        <nav className="flex-1 min-h-0 overflow-y-auto space-y-1">
          {inCampaign ? (
            <>
              {!collapsed && (
                <div className="mb-3">
                  <NavLink to="/campaigns" className="inline-flex items-center gap-1 px-1 text-xs font-medium text-fg-muted hover:text-brand-accent">
                    ‹ Campaigns
                  </NavLink>
                  <select
                    value={campaignId}
                    onChange={(e) => navigate(`/campaigns/${e.target.value}${currentSlug ? '/' + currentSlug : ''}`)}
                    title="Switch campaign"
                    className="mt-1 w-full rounded border border-border-strong bg-card px-2 py-1.5 text-sm font-semibold text-fg focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    {!campaigns.length && <option value={campaignId}>{currentCampaign?.name || 'Campaign'}</option>}
                    {campaigns.map((c) => (
                      <option key={c._id} value={c._id}>{c.name}{c.isActive === false ? ' · Archived' : ''}</option>
                    ))}
                  </select>
                </div>
              )}
              {CAMPAIGN_NAV.map((n) => {
                const Icon = navIcon(n.icon);
                const to = `/campaigns/${campaignId}${n.slug ? '/' + n.slug : ''}`;
                return (
                  <NavLink key={n.slug || 'home'} to={to} end={!n.slug} title={collapsed ? n.label : undefined} className={navClass(collapsed)}>
                    <Icon size={20} />
                    {!collapsed && <span>{n.label}</span>}
                  </NavLink>
                );
              })}
            </>
          ) : (
            <>
              {orgNav.map((n) => (
                <NavItem key={n.to} n={n} collapsed={collapsed} />
              ))}
              {isSuperAdmin && (
                <>
                  {collapsed ? (
                    <div className="my-2 border-t border-border" />
                  ) : (
                    <div className={GROUP_HEADER}>Platform</div>
                  )}
                  {SUPER_NAV.map((n) => (
                    <NavItem key={n.to} n={n} collapsed={collapsed} />
                  ))}
                </>
              )}
            </>
          )}
        </nav>

        <div
          className={[
            'mt-4 border-t border-border pt-3 shrink-0',
            collapsed ? 'flex flex-col items-center gap-1' : '',
          ].join(' ')}
        >
          <NavLink
            to="/help"
            title={collapsed ? 'Help' : undefined}
            className={navClass(collapsed)}
          >
            <IconHelp size={20} />
            {!collapsed && <span>Help</span>}
          </NavLink>
          <ThemeToggle collapsed={collapsed} dark={dark} toggle={toggleTheme} />
          {collapsed ? (
            <IconButton label="Sign out" onClick={logout} className="text-brand-accent hover:bg-brand-tint hover:text-brand-hover">
              <IconSignOut size={20} />
            </IconButton>
          ) : (
            <div className="mt-2 px-1">
              <NavLink to="/profile" className="block rounded-md py-0.5 hover:text-brand-accent">
                <div className="truncate text-sm font-medium text-fg">
                  {user?.firstName} {user?.lastName}
                </div>
                <div className="truncate text-xs text-fg-muted">{user?.email}</div>
              </NavLink>
              <button
                onClick={logout}
                className="mt-2 text-xs font-semibold text-brand-accent hover:text-brand-hover"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="md:hidden flex items-center gap-2 border-b border-border bg-card px-4 py-2">
          <Logo size={22} />
          <span className="text-xs text-fg-muted">
            Admin console{isSuperAdmin && <span className="ml-1 text-brand-accent">· super</span>}
          </span>
          <IconButton label="Toggle theme" onClick={toggleTheme} className="ml-auto">
            {dark ? <IconSun /> : <IconMoon />}
          </IconButton>
        </div>
        <main className={isFullBleed ? 'flex-1 overflow-hidden' : 'flex-1 overflow-auto p-6 pb-20 md:pb-6'}>
          {!isFullBleed && <AddedToOrgBanner />}
          {!isFullBleed && <BillingBanner />}
          <Suspense fallback={<ContentFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
