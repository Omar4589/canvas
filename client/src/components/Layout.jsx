import { Suspense, useEffect, useRef, useState } from 'react';
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

// Names the icons on the collapsed rail. The native `title` this replaces took about a second to
// appear, looked like an OS artifact, and was easy to miss entirely — so a rail of eighteen
// unlabeled glyphs was effectively unreadable.
//
// position:FIXED, and that is load-bearing: the nav is `overflow-y-auto`, and CSS resolves the
// other axis to `auto` too whenever one axis is not `visible` — so an absolutely-positioned tip
// would be clipped at the 64px rail edge, which is the whole bug it exists to avoid. Same reason
// RowMenu is fixed-positioned.
//
// pointer-events-none so the tip can never sit under the cursor and start a hide/show flicker.
function RailTip({ label, enabled, children }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);

  const show = () => {
    if (!enabled || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      // Centered on the icon, but clamped so an item scrolled to the very top or bottom of the
      // rail still gets a fully visible tip.
      top: Math.min(Math.max(r.top + r.height / 2, 18), window.innerHeight - 18),
      left: r.right + 10,
    });
  };
  const hide = () => setPos(null);

  return (
    <span
      ref={ref}
      className="block"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {enabled && pos && (
        <span
          // aria-hidden: the control itself carries an aria-label when collapsed, so announcing
          // this too would read the name twice.
          aria-hidden="true"
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateY(-50%)' }}
          className="pointer-events-none z-50 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-fg shadow-lg"
        >
          {label}
        </span>
      )}
    </span>
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

function ThemeToggleButton({ collapsed, dark, toggle }) {
  return (
    <button
      type="button"
      onClick={toggle}
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

// Wrapper so the collapsed rail's theme button gets the same tip as everything else on it.
function ThemeToggle({ collapsed, dark, toggle }) {
  return (
    <RailTip label={dark ? 'Light mode' : 'Dark mode'} enabled={collapsed}>
      <ThemeToggleButton collapsed={collapsed} dark={dark} toggle={toggle} />
    </RailTip>
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
  // Mock-GPS nudge: open mock-location flags for this campaign (61-day window, server-
  // computed). Drives the red badge on the Audit nav item below.
  const openMockFlags = currentCampaign?.openMockFlags || 0;
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
    location.pathname.endsWith('/packets') ||
    location.pathname === '/queues';

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
              {CAMPAIGN_NAV.map((n) => {
                const Icon = navIcon(n.icon);
                const to = `/campaigns/${campaignId}${n.slug ? '/' + n.slug : ''}`;
                // Mock-GPS nudge on the Audit item: expanded = red count pill, collapsed = red dot.
                const mockBadge = n.slug === 'audit' && openMockFlags > 0;
                const flagNote = mockBadge
                  ? `${openMockFlags} open mock-GPS flag${openMockFlags === 1 ? '' : 's'}`
                  : '';
                return (
                  <RailTip
                    key={n.slug || 'home'}
                    // Collapsed, the red dot on Audit is the only sign of the flag count — so the
                    // tip carries it, or the badge is unreadable on the rail.
                    label={mockBadge ? `${n.label} · ${flagNote}` : n.label}
                    enabled={collapsed}
                  >
                  <NavLink
                    to={to}
                    end={!n.slug}
                    aria-label={collapsed ? n.label : undefined}
                    title={!collapsed && mockBadge ? flagNote : undefined}
                    className={(s) => navClass(collapsed)(s) + (mockBadge ? ' relative' : '')}
                  >
                    <Icon size={20} />
                    {!collapsed && <span>{n.label}</span>}
                    {mockBadge && !collapsed && (
                      <span
                        aria-label={`${openMockFlags} open mock-GPS flags`}
                        className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold leading-none text-white ring-1 ring-white/60"
                      >
                        {openMockFlags}
                      </span>
                    )}
                    {mockBadge && collapsed && (
                      <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger" />
                    )}
                  </NavLink>
                  </RailTip>
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

        <div
          className={[
            'mt-4 border-t border-border pt-3 shrink-0',
            collapsed ? 'flex flex-col items-center gap-1' : '',
          ].join(' ')}
        >
          <RailTip label="Help" enabled={collapsed}>
            <NavLink
              to="/help"
              aria-label={collapsed ? 'Help' : undefined}
              className={navClass(collapsed)}
            >
              <IconHelp size={20} />
              {!collapsed && <span>Help</span>}
            </NavLink>
          </RailTip>
          <ThemeToggle collapsed={collapsed} dark={dark} toggle={toggleTheme} />
          {collapsed ? (
            <RailTip label="Sign out" enabled>
              <IconButton label="Sign out" onClick={logout} className="text-brand-accent hover:bg-brand-tint hover:text-brand-hover">
                <IconSignOut size={20} />
              </IconButton>
            </RailTip>
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

      {/* Mounted ONCE, at the shell. A SUPPORT_ACCESS_REQUIRED 403 can surface from any query on any
          screen — a per-page handler is one somebody forgets on the next page, and the gap would be a
          dead end with no way out. api/client.js broadcasts the event; this is what answers it. */}
      <SupportAccessGate />

      <BottomNav />
    </div>
  );
}
