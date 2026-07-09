import { useAuth } from '../auth/AuthContext.jsx';

// One source of truth for the marketing pages' primary call-to-action. A signed-in
// visitor is offered their dashboard (homePath — /campaigns for a lead, else /admin); a
// signed-out visitor is offered sign-in. Reuses the app's own auth (useAuth), so the
// landing page can never disagree with the app about who's logged in. Every CTA on the
// landing page (nav, hero, cta band, footer) should read from here rather than hardcode
// a /login link. While the session is still being verified (`loading`, only possible when
// a token exists) we report signed-out, so a big CTA shows "Sign in" for a frame then
// swaps to "Go to dashboard" — the caller can gate on `loading` if it prefers to wait.
export function useAuthCta() {
  const { user, loading, homePath } = useAuth();
  return {
    loading,
    authed: !!user,
    to: user ? homePath : '/login',
    label: user ? 'Go to dashboard' : 'Sign in',
  };
}
