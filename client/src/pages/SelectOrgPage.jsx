import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import { consoleHomePath } from '../lib/homePath.js';
import { consoleMemberships, nonConsoleMemberships } from '../lib/roles.js';
import { IOS_INSTALL_URL, ANDROID_INSTALL_URL } from '../lib/appLinks.js';
import Logo from '../components/Logo.jsx';

// Show the orgs where the user is a canvasser as a muted, non-clickable section (true), or
// hide them entirely (false). Showing them answers "where did my other org go?" BEFORE the
// user has to ask, and gives us a place to point them at the mobile app.
const SHOW_NO_CONSOLE_ORGS = true;

export default function SelectOrgPage() {
  const { user, memberships, isSuperAdmin, switchOrg, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [allOrgs, setAllOrgs] = useState([]);
  const [loadingOrgs, setLoadingOrgs] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    setLoadingOrgs(true);
    api('/super-admin/organizations')
      .then((res) => setAllOrgs(res.organizations || []))
      .catch(() => setAllOrgs([]))
      .finally(() => setLoadingOrgs(false));
  }, [isSuperAdmin]);

  // Only orgs where this user has console access are selectable. The picker used to list
  // EVERY membership, so an admin-in-A / canvasser-in-B user could click B and be sent to
  // /admin — an admin-only route they'd be Forbidden from, with no sidebar and no way back.
  const consoleItems = isSuperAdmin
    ? allOrgs.map((o) => ({
        organizationId: o.id,
        organizationName: o.name,
        role: 'super_admin',
        isActive: o.isActive,
      }))
    : consoleMemberships(memberships).map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organizationName,
        role: m.role,
        isActive: true,
      }));

  // Never for super admins — they can enter every org.
  const noConsoleItems = isSuperAdmin ? [] : nonConsoleMemberships(memberships);

  function pick(orgId, role) {
    switchOrg(orgId);
    // NOT homePathForRole(role): that returns null for a canvasser and, crucially, null for
    // the synthetic 'super_admin' role this page builds for super admins. consoleHomePath
    // knows about both.
    const home = consoleHomePath({ isSuperAdmin, role, hasActiveOrg: true }) || '/select-org';
    // Honor a real deep link if one brought them here.
    const deepLink = location.state?.from?.pathname;
    navigate(deepLink && deepLink !== '/select-org' ? deepLink : home, { replace: true });
  }

  function pickPlatform() {
    switchOrg(null);
    navigate('/super-admin', { replace: true });
  }

  // Exactly one org to choose → there is no choice. Enter it. (AuthContext already does this
  // at login; this covers a direct visit and a cleared-but-still-signed-in session.)
  const onlyOrg = !isSuperAdmin && consoleItems.length === 1 ? consoleItems[0] : null;
  useEffect(() => {
    if (!onlyOrg) return;
    pick(onlyOrg.organizationId, onlyOrg.role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyOrg?.organizationId]);

  const noConsoleOnly = !isSuperAdmin && consoleItems.length === 0 && noConsoleItems.length > 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-sunken px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <Logo size={32} />
          <h1 className="mt-3 text-lg font-semibold text-fg">
            {noConsoleOnly ? 'The web console is for admins and team leads' : 'Choose an organization'}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {noConsoleOnly
              ? `Hi ${user?.firstName}. You're a canvasser here — everything you need is in the Doorline mobile app. Sign in there with this same email and password.`
              : `Hi ${user?.firstName}. Pick the org you want to work in.`}
          </p>
        </div>

        {/* The install hand-off. Sits ABOVE the org list because for this user it is the ACTION and
            the list is only context. Gated on noConsoleOnly, not merely "not an admin": someone
            with no memberships at all can't use the app either, and they get the
            "not a member of any organization yet" empty state below instead. */}
        {noConsoleOnly && (
          <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-sm font-semibold text-fg">Get the app</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a
                href={IOS_INSTALL_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-border-strong px-3 py-2 text-sm font-semibold text-fg transition-colors hover:bg-sunken"
              >
                iPhone
              </a>
              <a
                href={ANDROID_INSTALL_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-border-strong px-3 py-2 text-sm font-semibold text-fg transition-colors hover:bg-sunken"
              >
                Android
              </a>
            </div>
            {/* Play internal testing needs the tester's Google account on an explicit list, so this
                link CAN wall someone. One line, so a wall reads as "ask" rather than "Doorline is
                broken" — see server/src/config/storeLinks.js. */}
            <p className="mt-2 text-xs text-fg-muted">
              The app is still in a closed test — if a link doesn’t work, ask whoever invited you.
            </p>
          </div>
        )}

        {isSuperAdmin && (
          <button
            onClick={pickPlatform}
            className="mb-3 flex w-full items-center justify-between rounded-xl border border-brand-accent/30 bg-brand-tint px-4 py-3 text-left text-sm font-semibold text-brand-accent transition-colors hover:bg-brand-tint"
          >
            <span>🌐 Platform view</span>
            <span className="text-[10px] uppercase tracking-wide text-brand-accent/70">
              all orgs
            </span>
          </button>
        )}

        {!noConsoleOnly && (
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            {loadingOrgs && (
              <div className="px-3 py-2 text-sm text-fg-muted">Loading orgs…</div>
            )}
            {!loadingOrgs && consoleItems.length === 0 && (
              <div className="px-3 py-2 text-sm text-fg-muted">
                {isSuperAdmin
                  ? 'No organizations exist yet. Create one to get started.'
                  : 'You are not a member of any organization yet.'}
              </div>
            )}
            <ul className="divide-y divide-border">
              {consoleItems.map((m) => (
                <li key={m.organizationId}>
                  <button
                    onClick={() => pick(m.organizationId, m.role)}
                    className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-brand-tint"
                    disabled={!m.isActive}
                  >
                    <span className="text-sm font-medium text-fg">
                      {m.organizationName}
                      {!m.isActive && (
                        <span className="ml-2 text-xs text-fg-subtle">(inactive)</span>
                      )}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-fg-muted">
                      {m.role}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Orgs the console can't open. Plain <li>s, not disabled buttons — a row that
            can't be clicked should not look like a button at all. */}
        {SHOW_NO_CONSOLE_ORGS && noConsoleItems.length > 0 && (
          <div
            className={`rounded-xl border border-border bg-card p-3 shadow-sm ${noConsoleOnly ? '' : 'mt-4'}`}
          >
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
              No console access
            </div>
            <ul className="divide-y divide-border">
              {noConsoleItems.map((m) => (
                <li
                  key={m.organizationId}
                  className="flex items-center justify-between px-2 py-2.5 opacity-60"
                >
                  <span className="text-sm font-medium text-fg-muted">{m.organizationName}</span>
                  <span className="text-xs uppercase tracking-wide text-fg-subtle">{m.role}</span>
                </li>
              ))}
            </ul>
            <p className="px-2 pt-2 text-xs text-fg-muted">
              You're a canvasser here — use the Doorline mobile app to knock doors.
            </p>
          </div>
        )}

        <div className="mt-4 text-center">
          <button
            onClick={() => {
              logout();
              navigate('/login', { replace: true });
            }}
            className="text-xs font-semibold text-fg-muted hover:text-fg-muted"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
