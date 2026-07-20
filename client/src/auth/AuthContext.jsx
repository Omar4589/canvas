import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  api,
  getToken,
  setToken,
  getActiveOrgId,
  setActiveOrgId,
} from '../api/client.js';
import { consoleHomePath } from '../lib/homePath.js';
import { activeOrgIdForLogin, consoleMemberships, isConsoleRole } from '../lib/roles.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [activeOrgId, setActiveOrgIdState] = useState(getActiveOrgId());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api('/auth/me')
      .then((res) => {
        setUser(res.user);
        setMemberships(res.memberships || []);
      })
      .catch(() => {
        setToken(null);
        setActiveOrgId(null);
        setActiveOrgIdState(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const res = await api('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setToken(res.token);
    setUser(res.user);
    setMemberships(res.memberships || []);
    // Auto-enter the org ONLY when the user has console access to exactly one — then there
    // is no choice to make and the picker is skipped. The old rule (memberships.length === 1)
    // auto-selected a CANVASSER org for a canvasser-only user, and did nothing at all for an
    // admin-in-A / canvasser-in-B user, who then hit the picker and could choose the org
    // they have no console in. A super admin always gets null — see lib/roles.js.
    //
    // Runs UNCONDITIONALLY now. It used to be skipped for super admins, which didn't just
    // decline to pick an org — it left whatever was already in localStorage untouched, so a
    // remembered org silently decided the landing page on every future login. Writing null
    // here actively clears the key (see api/client.js).
    const onlyOrg = activeOrgIdForLogin(res.user, res.memberships || []);
    setActiveOrgId(onlyOrg); // null removes the key — see api/client.js
    setActiveOrgIdState(onlyOrg);
    return res;
  }

  function logout() {
    setToken(null);
    setActiveOrgId(null);
    setActiveOrgIdState(null);
    setUser(null);
    setMemberships([]);
  }

  function switchOrg(orgId) {
    setActiveOrgId(orgId);
    setActiveOrgIdState(orgId);
  }

  async function changePassword(currentPassword, newPassword) {
    const res = await api('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
    // The change revokes every session issued before it — including the token that made this
    // request. Adopt the fresh one from the response, or the next call would 401 to /login.
    if (res.token) setToken(res.token);
    setUser(res.user);
    setMemberships(res.memberships || []);
    return res;
  }

  // Self-serve profile update (name/phone). Email is admin-only — see PATCH /auth/me.
  async function updateProfile({ firstName, lastName, phone }) {
    const res = await api('/auth/me', {
      method: 'PATCH',
      body: { firstName, lastName, phone },
    });
    setUser(res.user);
    setMemberships(res.memberships || []);
    return res;
  }

  async function acknowledgeMembership(membershipId) {
    await api(`/auth/memberships/${membershipId}/acknowledge`, { method: 'POST' });
    setMemberships((list) =>
      list.map((m) =>
        m.membershipId === membershipId ? { ...m, isNew: false } : m
      )
    );
  }

  const activeMembership = useMemo(
    () => memberships.find((m) => m.organizationId === activeOrgId) || null,
    [memberships, activeOrgId]
  );

  // Self-heal a stale activeOrgId. If the persisted org is one this user has NO console
  // role in — they were demoted, removed from the org, or the value was hand-edited / left
  // over from an older build — drop it. Everything downstream (ProtectedRoute's redirect,
  // the X-Org-Id header) then behaves as "no org chosen" and the user is routed to the
  // picker. Without this, a bad value in localStorage survived every reload and the only
  // way back into the app was to clear site data.
  //
  // Super admins are exempt: they legitimately hold an activeOrgId for orgs they are not
  // members of.
  useEffect(() => {
    if (loading || !user || user.isSuperAdmin || !activeOrgId) return;
    const m = memberships.find((x) => x.organizationId === activeOrgId);
    if (!m || !isConsoleRole(m.role)) {
      setActiveOrgId(null);
      setActiveOrgIdState(null);
    }
  }, [loading, user, activeOrgId, memberships]);

  const isSuperAdmin = !!user?.isSuperAdmin;
  const isOrgAdmin = isSuperAdmin || activeMembership?.role === 'admin';
  // Billing surfaces (the /billing nav item + route + in-app meter) are visible to super
  // admins and to org admins explicitly granted billing access on their membership.
  const canViewBilling = isSuperAdmin || (isOrgAdmin && !!activeMembership?.billingAccess);
  // A team lead is a campaign-scoped admin: they reach the console, but only for the
  // campaigns granted to them (managedCampaignIds). isConsoleUser = anyone who may see
  // the admin console at all (super/admin/lead).
  const isLead = !isOrgAdmin && activeMembership?.role === 'lead';
  const isConsoleUser = isOrgAdmin || isLead;
  // Can this user use the console AT ALL, in any org? Distinct from isConsoleUser, which is
  // about the ACTIVE org. The org-agnostic console routes (/profile, /help) gate on this, so
  // a multi-org admin who hasn't picked an org yet isn't locked out of them.
  const hasConsoleAccess = isSuperAdmin || consoleMemberships(memberships).length > 0;
  const managedCampaignIds = useMemo(
    () => (isLead ? activeMembership?.managedCampaignIds || [] : []),
    [isLead, activeMembership]
  );
  const mustChangePassword = !!user?.mustChangePassword;
  // Post-auth landing for THIS user (see lib/homePath.js): leads have no org Overview, so
  // they land on /campaigns; admins/super land on /admin. Render-time link/redirect sites
  // read this instead of hardcoding /admin (which a lead can't reach).
  //
  // ALWAYS a real path — the '/select-org' fallback is load-bearing, do not "clean it up".
  // Six render-time consumers pass homePath straight to <Link to> / navigate() (the
  // campaign-not-found screens on Dashboard/Timeline/Notes/Audit, the marketing CTA, and
  // ChangePasswordPage), and every one of them would break on null. null happens whenever
  // the active org has no console home for this user — in which case the picker (which
  // explains why) is exactly where they belong.
  const homePath =
    consoleHomePath({
      isSuperAdmin,
      role: activeMembership?.role,
      hasActiveOrg: !!activeOrgId,
    }) || '/select-org';
  // Org-wide audit timestamps (imports, walk lists, turf snapshots, user profiles) render
  // in the active org's timezone so they read the same for every admin.
  const orgTimeZone = activeMembership?.organizationTimeZone || 'America/New_York';

  return (
    <AuthContext.Provider
      value={{
        user,
        memberships,
        activeOrgId,
        activeMembership,
        orgTimeZone,
        isSuperAdmin,
        isOrgAdmin,
        canViewBilling,
        isLead,
        isConsoleUser,
        hasConsoleAccess,
        managedCampaignIds,
        homePath,
        mustChangePassword,
        loading,
        login,
        logout,
        switchOrg,
        changePassword,
        updateProfile,
        acknowledgeMembership,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

// The active org's IANA timezone — use for org-wide audit timestamps so they read the
// same for every admin regardless of their own device timezone.
export function useOrgTimeZone() {
  return useAuth().orgTimeZone;
}
