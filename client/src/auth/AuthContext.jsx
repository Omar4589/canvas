import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { focusManager, useQueryClient } from '@tanstack/react-query';
import {
  api,
  getToken,
  setToken,
  getActiveOrgId,
  setActiveOrgId,
  TOKEN_KEY,
  resolveSessionRestore,
  rejectSessionRestore,
  setSessionPromptUp,
} from '../api/client.js';
import { consoleHomePath } from '../lib/homePath.js';
import { activeOrgIdForLogin, consoleMemberships, isConsoleRole } from '../lib/roles.js';
import {
  sessionEndReason,
  webAction,
  tokenClaims,
  renewCheckDue,
  shouldAdoptRenewedToken,
  isPublicPath,
  keepReauthInPlace,
} from '../lib/sessionEnd.js';

const AuthContext = createContext(null);

// How often an open, visible tab looks at whether its sign-in can be extended. renewCheckDue
// (lib/sessionEnd.js) decides whether a request actually goes out: only for a token old enough,
// in a tab someone has used since it was issued, and never more than once per six hours.
const RENEW_LOOK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// After a session comes back, refetch only what failed while it was out — never everything,
// which re-renders whole pages under the person and can swap a page's form for an error state.
const ONLY_FAILED = { predicate: (q) => q.state.status === 'error' };

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [activeOrgId, setActiveOrgIdState] = useState(getActiveOrgId());
  const [loading, setLoading] = useState(true);
  // A sign-in that ran out, waiting for the password IN PLACE (components/ReauthModal.jsx):
  // { reason, sentToken, identity: { id, email }, raisedAt, activeAt } — raisedAt is when it went
  // up, activeAt when someone last used it. Nothing navigates while it is up, so unsaved edits on
  // the page underneath survive. The dead token stays stored until the password replaces it —
  // clearing it would push every other open tab into a sign-out. Changed only through putReauth.
  const [reauth, setReauth] = useState(null);
  // Why the page-load check found the session over (a deliberate end), for the sign-in note.
  const [endedReason, setEndedReason] = useState(null);
  // The page-load check couldn't reach Doorline (a 5xx, or offline): the sign-in is KEPT and
  // ProtectedRoute offers Try again. It used to clear the token on any failure, so a server blip
  // at page load signed the browser out.
  const [bootError, setBootError] = useState(false);

  // Read by listeners registered once.
  const userRef = useRef(null);
  userRef.current = user;
  const reauthRef = useRef(null);
  // Requests that must never land after a sign-out: the password prompt's login and a renewal.
  const reauthAbortRef = useRef(null);
  const renewAbortRef = useRef(null);
  // A password change from this tab, in flight: the token it is replacing.
  const rotatingFromRef = useRef(null);
  // The first deliberate-end redirect wins (later answers can only be bare requests, `missing`,
  // which would overwrite the real reason). Set only right before navigating away.
  const redirectingRef = useRef(false);
  const lastCheckRef = useRef(0);
  const lastInteractionRef = useRef(0);

  // Every change to the prompt goes through here. The ref is updated at once, not at the next
  // render, so a listener that runs in between (another tab's storage event, a second ended
  // answer) sees the prompt that is really up; and api/client.js learns whether to hold requests
  // for it.
  const putReauth = useCallback((next) => {
    reauthRef.current = next;
    setSessionPromptUp(!!next);
    setReauth(next);
  }, []);

  // Another tab stored a token for the same person (they typed the password there, or extended the
  // sign-in there): a prompt here is answered too. Held requests run again with that token, then
  // whatever still failed. A tab whose user never loaded (the prompt went up at page load) loads now.
  const adoptSamePersonToken = useCallback(() => {
    if (!reauthRef.current) return;
    putReauth(null);
    if (userRef.current) {
      resolveSessionRestore();
      queryClient.invalidateQueries(ONLY_FAILED);
    } else {
      window.location.reload();
    }
  }, [putReauth, queryClient]);

  // The page-load check. Quiet: it handles its own answer.
  useEffect(() => {
    const sent = getToken();
    if (!sent) {
      setLoading(false);
      return undefined;
    }
    const ac = new AbortController();
    api('/auth/me', { signal: ac.signal, quiet: true })
      .then((res) => {
        const current = getToken();
        if (current !== sent) {
          // Another tab changed the stored token while this check was out — most often its own
          // page-load check extended the same sign-in first (tabs restored together on the first
          // load of a day). Same person: carry on with that token. Someone else signed in: start
          // over as them. Signed out: the sign-in page is right.
          const samePerson = !!current && String(tokenClaims(current)?.sub) === String(res.user?.id);
          if (!samePerson) {
            if (current) window.location.reload();
            return;
          }
        }
        setUser(res.user);
        setMemberships(res.memberships || []);
        if (shouldAdoptRenewedToken({ sentToken: sent, currentToken: current, newToken: res.token })) {
          setToken(res.token);
        }
      })
      .catch((err) => {
        if (ac.signal.aborted || err?.name === 'AbortError') return;
        if (getToken() !== sent) {
          // The stored token changed under a failed check: run the check again with it.
          if (getToken()) window.location.reload();
          return;
        }
        const reason = sessionEndReason(err?.status, err?.data);
        if (reason && webAction(reason) === 'reauth') {
          // The page opened on a sign-in that ran out: ask for the password right here, keeping
          // the deep link and the active org. Who it was comes from the token itself.
          const claims = tokenClaims(sent);
          putReauth({
            reason,
            sentToken: sent,
            identity: claims?.sub ? { id: String(claims.sub), email: claims.email || '' } : null,
            raisedAt: Date.now(),
          });
        } else if (reason || err?.status === 401) {
          // A deliberate end (password changed elsewhere, account deleted), or an older server's
          // uncoded 401: the sign-in is over.
          setToken(null);
          setActiveOrgId(null);
          setActiveOrgIdState(null);
          setEndedReason(reason);
        } else {
          setBootError(true);
        }
      })
      .finally(() => {
        // StrictMode's first, aborted run must not end loading with no user (that redirected a
        // dev load to /login before the real check answered).
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [putReauth]);

  // Ended sessions reported by api/client.js — any request, any page.
  useEffect(() => {
    const onEnded = (e) => {
      const { reason, sentToken } = e.detail || {};
      if (!reason) return;
      // This tab's own password change is on its way (no prompt is holding it back): until the new
      // token lands, a password-changed answer is that change's doing — from the token it replaces,
      // or from a request the prompt held and sent again meanwhile — and must not sign out the
      // person who just changed it. While the prompt is up the change is still held behind it and
      // can't have happened yet, so an answer then is a change made elsewhere: handled as usual.
      if (rotatingFromRef.current && reason === 'password_changed' && !reauthRef.current) return;
      // Another tab signed out, or a password reset finished there (which clears the shared
      // token), while this tab's prompt is up: the prompt keeps this tab's unsaved work safe until
      // the person decides — sign in again here, or "Not you? Sign out".
      if (reason === 'missing' && reauthRef.current) return;
      if (webAction(reason, { reauthUp: keepReauthInPlace(reauthRef.current, Date.now()) }) === 'reauth') {
        const current = getToken();
        if (!current) {
          // Nothing stored to ask the password for (the answer was about the stored token, so this
          // shouldn't happen). Never leave a request held with no prompt to release it.
          if (!reauthRef.current) rejectSessionRestore();
          return;
        }
        const cur = reauthRef.current;
        if (cur && cur.sentToken === current) {
          // Already asking. A password change switches to the new-password wording and restarts the
          // reset window once (changeHeardAt, lib/sessionEnd.js); a repeat answer changes nothing.
          if (reason === 'password_changed' && cur.reason !== 'password_changed') {
            putReauth({ ...cur, reason, changeHeardAt: Date.now() });
          }
          return;
        }
        const u = userRef.current;
        const claims = tokenClaims(current);
        let identity = null;
        if (u) identity = { id: String(u.id), email: u.email };
        else if (claims?.sub) identity = { id: String(claims.sub), email: claims.email || '' };
        putReauth({ reason, sentToken: current, identity, raisedAt: Date.now() });
        return;
      }
      // A deliberate end: forget the token and go to the sign-in page with a note — never off a
      // public page (a stale token on /reset-password/:token or a shared report must not yank
      // the person away; forgetting it is enough there).
      reauthAbortRef.current?.abort();
      renewAbortRef.current?.abort();
      rejectSessionRestore();
      putReauth(null);
      setToken(null);
      if (isPublicPath(window.location.pathname) || redirectingRef.current) return;
      redirectingRef.current = true;
      window.location.assign(`/login?signedOut=${encodeURIComponent(reason)}`);
    };
    window.addEventListener('doorline:session-ended', onEnded);
    return () => window.removeEventListener('doorline:session-ended', onEnded);
  }, [putReauth]);

  // A different person signed in elsewhere while this tab was on a public page (a reset in progress,
  // a shared report), which is nobody's session to follow and must not be navigated away from: the
  // last person is forgotten in place — nothing of theirs keeps rendering, nothing held for their
  // prompt runs under the new sign-in — and the first move off the public page loads the stored
  // sign-in fresh (the effect below).
  const staleSessionRef = useRef(false);
  const forgetPerson = useCallback(() => {
    staleSessionRef.current = true;
    reauthAbortRef.current?.abort();
    renewAbortRef.current?.abort();
    rejectSessionRestore();
    putReauth(null);
    userRef.current = null;
    setUser(null);
    setMemberships([]);
  }, [putReauth]);

  // This tab's idea of who is signed in must match the stored token. Run on every storage event,
  // prompt change and page change, and right after this tab stores a token itself (storage events
  // never fire in the tab that wrote):
  //   - the same person, with a token the prompt wasn't raised for (the password typed, or the
  //     sign-in extended, in another tab or this one): the prompt is answered too — on any page, a
  //     public one included, so a prompt never outlives its token;
  //   - a different person: this tab must not keep showing the last person under the new person's
  //     token. Off a public page it reloads into the stored sign-in (/login lands that person on
  //     their home); on a public page it forgets the last person at once (forgetPerson).
  // A removed token needs nothing here: this tab's next request answers `missing`, and a deliberate
  // sign-out follows (or the password prompt keeps its edits).
  const reconcileStoredToken = useCallback(() => {
    const stored = getToken();
    if (!stored) return;
    const prompt = reauthRef.current;
    const mine = userRef.current?.id ?? prompt?.identity?.id;
    if (!mine) return;
    const sub = tokenClaims(stored)?.sub;
    if (sub && String(sub) === String(mine)) {
      if (prompt && stored !== prompt.sentToken) adoptSamePersonToken();
      return;
    }
    if (isPublicPath(window.location.pathname)) forgetPerson();
    else window.location.assign('/login');
  }, [adoptSamePersonToken, forgetPerson]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === TOKEN_KEY && e.newValue) reconcileStoredToken();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [reconcileStoredToken]);

  // The backstop, for a storage event that landed before the prompt went up or the user loaded: the
  // same check on every prompt, user or page change. A tab that forgot the last person on a public
  // page reloads into the stored sign-in as soon as it leaves the public page.
  useEffect(() => {
    if (staleSessionRef.current) {
      if (!isPublicPath(location.pathname)) window.location.assign('/login');
      return;
    }
    reconcileStoredToken();
  }, [reauth, user, location.pathname, reconcileStoredToken]);

  // While the password prompt is up, polls pause (react-query treats the tab as unfocused). The one
  // poll that runs in the background anyway (refetchIntervalInBackground) is held with the rest and
  // doesn't stack up: react-query joins the held fetch. All resume once the session is back.
  useEffect(() => {
    focusManager.setFocused(reauth ? false : undefined);
    return () => focusManager.setFocused(undefined);
  }, [reauth]);

  // A used sign-in stays alive in a tab that stays open: about once a day, while someone is using
  // it, GET /auth/me returns an extended token. Checked when the tab comes back into view and on a
  // slow interval; an unattended wall display never extends itself.
  useEffect(() => {
    if (!user) return undefined;
    const onInteract = () => {
      lastInteractionRef.current = Date.now();
    };
    const look = () => {
      if (document.visibilityState !== 'visible' || reauthRef.current) return;
      const sent = getToken();
      const now = Date.now();
      if (
        !renewCheckDue({
          token: sent,
          now,
          lastCheckAt: lastCheckRef.current,
          lastInteractionAt: lastInteractionRef.current,
        })
      ) {
        return;
      }
      lastCheckRef.current = now;
      renewAbortRef.current?.abort();
      const ac = new AbortController();
      renewAbortRef.current = ac;
      // Not quiet: if the sign-in turns out to be over, this is how the tab finds out.
      api('/auth/me', { signal: ac.signal })
        .then((res) => {
          if (shouldAdoptRenewedToken({ sentToken: sent, currentToken: getToken(), newToken: res.token })) {
            setToken(res.token);
            // A poll may have raised the prompt for the old token at its expiry instant meanwhile.
            reconcileStoredToken();
          }
        })
        .catch(() => {})
        .finally(() => {
          if (renewAbortRef.current === ac) renewAbortRef.current = null;
        });
    };
    window.addEventListener('pointerdown', onInteract, { passive: true });
    window.addEventListener('keydown', onInteract, { passive: true });
    document.addEventListener('visibilitychange', look);
    const interval = setInterval(look, RENEW_LOOK_INTERVAL_MS);
    return () => {
      window.removeEventListener('pointerdown', onInteract);
      window.removeEventListener('keydown', onInteract);
      document.removeEventListener('visibilitychange', look);
      clearInterval(interval);
      renewAbortRef.current?.abort();
      renewAbortRef.current = null;
    };
  }, [user, reconcileStoredToken]);

  const login = async (email, password) => {
    const res = await api('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    // Signing in on the sign-in page starts over: anything still held for an old prompt fails
    // rather than running under this sign-in, which may be someone else's — and nothing the last
    // person loaded in this tab may paint under this one (a shared computer: sign out, or a tab that
    // forgot its person, then someone else signs in here). Most console query keys don't name the
    // person or the org, so a cached page would show until the new person's fetch replaced it.
    rejectSessionRestore();
    staleSessionRef.current = false;
    queryClient.clear();
    setToken(res.token);
    setUser(res.user);
    setMemberships(res.memberships || []);
    putReauth(null);
    setEndedReason(null);
    setBootError(false);
    redirectingRef.current = false;
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
    //
    // A sign-in that merely RAN OUT never comes through here: the password prompt continues the
    // session in place (reauthenticate below) and leaves the org alone, like a reload. Typing your
    // password on the sign-in page starts you at your home (lib/roles.js).
    const onlyOrg = activeOrgIdForLogin(res.user, res.memberships || []);
    setActiveOrgId(onlyOrg); // null removes the key — see api/client.js
    setActiveOrgIdState(onlyOrg);
    return res;
  };

  // The password prompt (components/ReauthModal.jsx). The same person continues exactly where
  // they were: token, user and memberships are refreshed; the active org, the page and its
  // unsaved state are untouched. Throws the server's message for a wrong password, so the prompt
  // can show it.
  const reauthenticate = async (email, password) => {
    const sent = getToken();
    reauthAbortRef.current?.abort();
    const ac = new AbortController();
    reauthAbortRef.current = ac;
    try {
      const res = await api('/auth/login', {
        method: 'POST',
        body: { email, password },
        quiet: true,
        signal: ac.signal,
      });
      // Signed out here, or another sign-in stored meanwhile: the fresh session must not linger,
      // unstored and unended. (Another tab signing out — no token stored now — is not that: the
      // prompt stays up for exactly that case, and the password typed here continues this tab.)
      const discard = () =>
        api('/auth/logout', { method: 'POST', token: res.token, quiet: true }).catch(() => {});
      const now = getToken();
      if (ac.signal.aborted || (now !== sent && now !== null)) {
        discard();
        return false;
      }
      const expected = userRef.current?.id ?? reauthRef.current?.identity?.id;
      if (expected && String(res.user?.id) !== String(expected)) {
        // A different account: never continue this person's page as someone else.
        discard();
        logout();
        window.location.assign('/login');
        return false;
      }
      setToken(res.token);
      setUser(res.user);
      setMemberships(res.memberships || []);
      putReauth(null);
      setEndedReason(null);
      setBootError(false);
      // This tab continues in its own org; written back so its next full load (a refresh, the
      // forced password change below) starts there too — a reset or a sign-in in another tab may
      // have cleared or changed the stored one. A tab with no org (the picker, the profile, the
      // platform view) leaves the stored one alone rather than erasing another tab's choice.
      const tabOrg = getActiveOrgId();
      if (tabOrg) setActiveOrgId(tabOrg);
      // Requests held for the password run again now (api/client.js), then whatever still failed.
      resolveSessionRestore();
      queryClient.invalidateQueries(ONLY_FAILED);
      if (res.user?.mustChangePassword) window.location.assign('/change-password');
      return true;
    } finally {
      if (reauthAbortRef.current === ac) reauthAbortRef.current = null;
    }
  };

  const logout = () => {
    reauthAbortRef.current?.abort();
    renewAbortRef.current?.abort();
    rejectSessionRestore();
    // Only a tab that holds a person ends the stored session. A tab that forgot its person (someone
    // else signed in elsewhere), or never had one (a reset link opened in a fresh tab), holds nobody's
    // session here: the stored token and org belong to whoever signed in elsewhere, and signing out
    // in this tab (the reset page does) must not end them.
    if (!staleSessionRef.current && (userRef.current || reauthRef.current)) {
      // Ends the session on the server too, so copies of the token stop working. api() reads the
      // token synchronously, before the line below clears it; with no network it never arrives
      // and the session simply runs out.
      if (getToken()) api('/auth/logout', { method: 'POST', quiet: true }).catch(() => {});
      setToken(null);
      setActiveOrgId(null);
    }
    setActiveOrgIdState(null);
    setUser(null);
    setMemberships([]);
    putReauth(null);
  };

  function switchOrg(orgId) {
    setActiveOrgId(orgId);
    setActiveOrgIdState(orgId);
  }

  const changePassword = async (currentPassword, newPassword) => {
    rotatingFromRef.current = getToken();
    try {
      const res = await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      // The change revokes every session issued before it — including the token that made this
      // request. Adopt the fresh one from the response, or the next call would 401 to /login.
      if (res.token) setToken(res.token);
      setUser(res.user);
      setMemberships(res.memberships || []);
      // A poll may have raised the prompt for the old token just before the new one landed.
      reconcileStoredToken();
      // Anything that left with the old token while the change was in flight failed with a 401
      // that is not retried: run it again with the new one.
      queryClient.invalidateQueries(ONLY_FAILED);
      return res;
    } finally {
      rotatingFromRef.current = null;
    }
  };

  // Someone used the password prompt (a sign-in attempt, "Forgot password?"): the reset window
  // (lib/sessionEnd.js resetWindowOpen) runs from here.
  const touchReauth = () => {
    const cur = reauthRef.current;
    if (cur) putReauth({ ...cur, activeAt: Date.now() });
  };

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
        reauth,
        endedReason,
        bootError,
        login,
        logout,
        reauthenticate,
        touchReauth,
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
