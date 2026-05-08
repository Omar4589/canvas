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

  const activeMembership = useMemo(
    () => memberships.find((m) => m.organizationId === activeOrgId) || null,
    [memberships, activeOrgId]
  );

  const isSuperAdmin = !!user?.isSuperAdmin;
  const isOrgAdmin = isSuperAdmin || activeMembership?.role === 'admin';

  return (
    <AuthContext.Provider
      value={{
        user,
        memberships,
        activeOrgId,
        activeMembership,
        isSuperAdmin,
        isOrgAdmin,
        loading,
        login,
        logout,
        switchOrg,
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
