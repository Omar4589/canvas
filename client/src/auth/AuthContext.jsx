import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  api,
  getToken,
  setToken,
  getActiveOrgId,
  setActiveOrgId,
} from '../api/client.js';

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
    if ((res.memberships || []).length === 1 && !res.user.isSuperAdmin) {
      const onlyOrg = res.memberships[0].organizationId;
      setActiveOrgId(onlyOrg);
      setActiveOrgIdState(onlyOrg);
    }
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

  const isSuperAdmin = !!user?.isSuperAdmin;
  const isOrgAdmin = isSuperAdmin || activeMembership?.role === 'admin';
  const mustChangePassword = !!user?.mustChangePassword;
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
