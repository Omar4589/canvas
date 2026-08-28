import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../lib/useTheme.js';
import Logo, { LogoMark } from './Logo.jsx';
import { ORG_NAV, CAMPAIGN_NAV, CAMPAIGN_NAV_GROUPS, SUPER_NAV } from './navItems.js';
import { navIcon, IconChevron } from './navIcons.jsx';
import { IconSun, IconMoon } from './ui/icons.jsx';
import { Tooltip } from './ui/Popover.jsx';
import IconButton from './ui/IconButton.jsx';
import AccountMenu from './AccountMenu.jsx';
import OrgSwitcher from './OrgSwitcher.jsx';
import SupportAccessGate from './SupportAccessGate.jsx';
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

// Names the icons on the collapsed rail — a rail of eighteen unlabeled glyphs is otherwise
// unreadable. The floating/clipping/aria mechanics all live in the shared ui Tooltip now (this
// component was where they were first worked out); what stays here is the rail's own geometry:
// the tip sits to the RIGHT of the icon, and `block` keeps the wrapper filling the nav item the
// way the original span did rather than shrink-wrapping the glyph.
function RailTip({ label, enabled, children }) {
  return (
    <Tooltip label={label} enabled={enabled} placement="right" block>
      {children}
    </Tooltip>
  );
}

function NavItem({ n, collapsed }) {
  const Icon = navIcon(n.to);
  return (
    <RailTip label={n.label} enabled={collapsed}>
      <NavLink
        to={n.to}
        end={n.end}
        // The label is the only accessible name once the text is hidden.
        aria-label={collapsed ? n.label : undefined}
        className={navClass(collapsed)}
      >
        <Icon size={20} />
        {!collapsed && <span>{n.label}</span>}
      </NavLink>
    </RailTip>
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

export default function Layout() {
  const { user, isSuperAdmin, isLead, canViewBilling } = useAuth();
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
  // Mock-GPS nudge: open mock-location flags for this campaign (61-day window, server-
  // computed). Drives the red badge on the Audit nav item below.
  const openMockFlags = currentCampaign?.openMockFlags || 0;
  // Approximate pins still awaiting a fix or confirm (campaignSummaries.pinsToFix, the same
  // predicate the Pin Fixes page lists). Drives the amber badge on the Pin Fixes item.
  const pinsToFix = currentCampaign?.pinsToFix || 0;
  // The switcher LISTS active campaigns only — archived ones live on the Campaigns and
  // Overview pages, which is also where you reactivate them. It deliberately does NOT
  // validate against that filtered list: the current campaign stays listed even when
  // archived, because both org pages link straight into an archived campaign and a <select>
  // whose value matches no <option> renders blank. (mobile/lib/campaignSelection.js has the
  // full story — an active-only *validity* check once stranded an all-archived org with
  // nothing to pick.) `isActive === false`, never `!isActive`: a row from an older server
  // that omits the field must read as active, not drop out of the list.
  const pickerCampaigns = campaigns.filter(
    (c) => c.isActive !== false || String(c._id) === String(campaignId)
  );

  const isFullBleed =
    location.pathname.endsWith('/map') ||
    location.pathname.endsWith('/turfs') ||
    location.pathname.endsWith('/pin-fixes') ||
    location.pathname.endsWith('/packets') ||
    location.pathname === '/queues';

  // One campaign nav item, shared by the ungrouped Home row and every grouped section below —
  // extracted so the grouping can't fork the badge/tooltip behavior per section.
  const renderCampaignItem = (n) => {
    const Icon = navIcon(n.icon);
    const to = `/campaigns/${campaignId}${n.slug ? '/' + n.slug : ''}`;
    // Mock-GPS nudge on the Audit item: expanded = red count pill, collapsed = red dot.
    const mockBadge = n.slug === 'audit' && openMockFlags > 0;
    // Pin Fixes workload: same pill/dot mechanism, amber — a to-do count, not an alarm.
    const pinBadge = n.slug === 'pin-fixes' && pinsToFix > 0;
    const flagNote = mockBadge
      ? `${openMockFlags} open mock-GPS flag${openMockFlags === 1 ? '' : 's'}`
      : pinBadge
        ? `${pinsToFix} approximate pin${pinsToFix === 1 ? '' : 's'} to fix`
        : '';
    const badgeCount = mockBadge ? openMockFlags : pinBadge ? pinsToFix : 0;
    const hasBadge = mockBadge || pinBadge;
    return (
      <RailTip
        key={n.slug || 'home'}
        // Collapsed, the dot on Audit / Pin Fixes is the only sign of the count — so the
        // tip carries it, or the badge is unreadable on the rail.
        label={hasBadge ? `${n.label} · ${flagNote}` : n.label}
        enabled={collapsed}
      >
        <NavLink
          to={to}
          end={!n.slug}
          aria-label={collapsed ? n.label : undefined}
          title={!collapsed && hasBadge ? flagNote : undefined}
          className={(s) => navClass(collapsed)(s) + (hasBadge ? ' relative' : '')}
        >
          <Icon size={20} />
          {!collapsed && <span>{n.label}</span>}
          {hasBadge && !collapsed && (
            <span
              aria-label={flagNote}
              // Amber pill = tint + warning-fg, the repo's small-amber-text pair (white on solid
              // bg-warning fails WCAG AA at this size); the red danger pill keeps its precedent.
              className={`ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ring-1 ring-white/60 ${mockBadge ? 'bg-danger text-white' : 'bg-warning-tint text-warning-fg'}`}
            >
              {badgeCount}
            </span>
          )}
          {hasBadge && collapsed && (
            <span className={`absolute right-1 top-1 h-2 w-2 rounded-full ${mockBadge ? 'bg-danger' : 'bg-warning'}`} />
          )}
        </NavLink>
      </RailTip>
    );
  };

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
            collapsed ? 'mb-4 flex flex-col items-center gap-2' : 'mb-1 flex items-center justify-between px-3',
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
          <div className="mb-4 px-3 text-xs text-fg-muted shrink-0">
            Admin console{isSuperAdmin && <span className="ml-1 text-brand-accent">· super</span>}
            {isLead && <span className="ml-1 text-brand-accent">· team lead</span>}
          </div>
        )}

        {!collapsed && (
          <div className="shrink-0">
            <OrgSwitcher />
          </div>
        )}

        {/* The nav is the sidebar's only scroll container, and the header and footer sit outside
            it — so wherever the browser draws a CLASSIC (space-consuming) scrollbar it ate ~15px
            of the collapsed rail's 48px column and shifted every nav icon left of the logo and
            avatar. This is the confirmed cause of the rail misalignment, not a theoretical one.

            Collapsed, the scrollbar is hidden outright (the rail still scrolls by wheel/trackpad)
            — the same treatment every icon rail uses, and the only one that keeps the icons on the
            column's true center AND leaves room for a full-width 48px hover pill. `scrollbar-gutter:
            stable both-edges` would also center them, but it reserves the bar's width on BOTH sides:
            30px out of 48 on a classic scrollbar, squeezing the pill to 18px.

            Expanded there is nothing to center — labels are left-aligned — so the scrollbar stays
            visible, with `stable` reserving its width so labels don't jump 15px sideways when the
            9-item org nav swaps for the 18-item campaign nav. */}
        <nav
          className={[
            'flex-1 min-h-0 space-y-1 overflow-y-auto',
            collapsed
              ? '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
              : '[scrollbar-gutter:stable]',
          ].join(' ')}
        >
          {inCampaign ? (
            <>
              {!collapsed && (
                <div className="mb-3">
                  <NavLink to="/campaigns" className="inline-flex items-center gap-1 px-3 text-xs font-medium text-fg-muted hover:text-brand-accent">
                    ‹ Campaigns
                  </NavLink>
                  <select
                    value={campaignId}
                    onChange={(e) => navigate(`/campaigns/${e.target.value}${currentSlug ? '/' + currentSlug : ''}`)}
                    title="Switch campaign"
                    className="mt-1 w-full rounded border border-border-strong bg-card px-2 py-1.5 text-sm font-semibold text-fg focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    {/* Covers every case the list can't: still loading, and a campaign this
                        viewer's list doesn't contain (a lead's scope, or one deleted under a
                        stale cache). Without it the select would render blank. */}
                    {!pickerCampaigns.some((c) => String(c._id) === String(campaignId)) && (
                      <option value={campaignId}>{currentCampaign?.name || 'Campaign'}</option>
                    )}
                    {pickerCampaigns.map((c) => (
                      <option key={c._id} value={c._id}>{c.name}{c.isActive === false ? ' · Archived' : ''}</option>
                    ))}
                  </select>
                </div>
              )}
              {/* Home rides ungrouped at the top; the rest render in CAMPAIGN_NAV_GROUPS order —
                  same header-when-expanded / divider-when-collapsed treatment as the
                  super-admin Platform section below. */}
              {CAMPAIGN_NAV.filter((n) => !n.group).map(renderCampaignItem)}
              {CAMPAIGN_NAV_GROUPS.map((g) => {
                const items = CAMPAIGN_NAV.filter((n) => n.group === g.key);
                if (!items.length) return null;
                return (
                  <div key={g.key} className="space-y-1">
                    {collapsed ? (
                      <div className="my-2 border-t border-border" />
                    ) : (
                      <div className={GROUP_HEADER}>{g.label}</div>
                    )}
                    {items.map(renderCampaignItem)}
                  </div>
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
                  {SUPER_NAV.filter((n) => !n.breakGlassOnly || user?.platformRole === 'break_glass').map((n) => (
                    <NavItem key={n.to} n={n} collapsed={collapsed} />
                  ))}
                </>
              )}
            </>
          )}
        </nav>

        {/* No `items-center` when collapsed: that shrink-wrapped every footer control to its own
            glyph, so each sat in a narrower pill than the 48px nav items right above it. */}
        <div className="mt-4 shrink-0 border-t border-border pt-3">
          <AccountMenu collapsed={collapsed} />
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

      {/* Mounted ONCE, at the shell. A SUPPORT_ACCESS_REQUIRED 403 can surface from any query on any
          screen — a per-page handler is one somebody forgets on the next page, and the gap would be a
          dead end with no way out. api/client.js broadcasts the event; this is what answers it. */}
      <SupportAccessGate />

      <BottomNav />
    </div>
  );
}
