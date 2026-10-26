import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getShareSession } from '../lib/shareSession.js';
import { shareAccessKey } from '../lib/shareAccess.js';
import { classifyShareError, shareRetry, SHARE_COPY } from '../lib/shareErrors.js';
import Logo, { LogoMark } from './Logo.jsx';
import { Button, Card } from './ui/index.js';
import { FIELD_CLS } from './ui/Input.jsx';
import { IconEye, IconEyeOff } from './ui/icons.jsx';

// Public shell for a shared report hub (/r/:token) — no login, no account chrome
// (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F6, §H1).
//
//   · The gate is neutral: nothing about the campaign shows before the password is right. The link's
//     meta answers { requiresPassword } only; the campaign, the organization and the logo ride the
//     hub call, behind the password.
//   · "Keep me signed in on this device" keeps the token in localStorage (up to its 30 days), else
//     sessionStorage for this tab; "Sign out on this device" clears both (lib/shareAccess.js).
//   · Every share call goes through ONE error handler (lib/shareSession.js): a 401 brings the gate
//     back with "it may have changed" and asks the link again; a dead or expired link drops the
//     token and says so; what's left is each page's to show.
//   · Light theme always, like the marketing site: this is a document the client reads.

function Centered({ children }) {
  return <div className="flex min-h-[40vh] items-center justify-center px-4 text-sm text-fg-muted">{children}</div>;
}

function GatePassword({ id, value, onChange, disabled }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        autoComplete="off"
        required
        disabled={disabled}
        className={`${FIELD_CLS} w-full pr-10`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-2 flex items-center text-fg-subtle hover:text-fg-muted"
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <IconEyeOff size={18} /> : <IconEye size={18} />}
      </button>
    </div>
  );
}

/**
 * The password gate. `reason`: null (first visit), 'changed' (a 401 brought it back — the password,
 * the link or the token's life changed) or 'signed-out'. Nothing about the campaign, ever.
 */
export function ShareGate({ reason = null, error = null, busy = false, requiresPassword = true, onSubmit }) {
  const id = useId();
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  return (
    <div className="mx-auto max-w-sm pt-6 sm:pt-12">
      <Card
        as="form"
        className="p-6"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.(requiresPassword ? { password, remember } : { remember });
        }}
      >
        <Logo size={26} className="justify-center" />
        <p className="mt-4 text-center text-sm font-semibold text-fg">A report has been shared with you.</p>
        {requiresPassword && <p className="mt-1 text-center text-sm text-fg-muted">Enter the password you were given.</p>}
        {reason === 'changed' && (
          <p className="mt-4 rounded-lg bg-warning-tint p-3 text-xs leading-relaxed text-warning-fg">{SHARE_COPY.password}</p>
        )}
        {reason === 'signed-out' && (
          <p className="mt-4 rounded-lg bg-sunken p-3 text-xs leading-relaxed text-fg-muted">{SHARE_COPY.signedOut}</p>
        )}
        {requiresPassword && (
          <div className="mt-4">
            <label htmlFor={id} className="sr-only">
              Password
            </label>
            <GatePassword id={id} value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
          </div>
        )}
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border-strong text-brand-accent focus-visible:ring-ring"
          />
          <span>
            Keep me signed in on this device
            <span className="block text-xs text-fg-muted">Up to 30 days. Leave it off on a shared computer.</span>
          </span>
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger-fg">
            {error}
          </p>
        )}
        <Button type="submit" loading={busy} className="mt-4 w-full">
          View report
        </Button>
      </Card>
    </div>
  );
}

/**
 * A dead end or a retry: `kind` 'link-gone' | 'expired' (with the server's `message`) | 'retry'
 * (with `onRetry`). Says what happened and what to do — never that nothing was published.
 */
export function ShareNotice({ kind, message = null, onRetry = null }) {
  const [title, body] =
    kind === 'link-gone'
      ? [SHARE_COPY.linkGoneTitle, SHARE_COPY.linkGone]
      : kind === 'expired'
        ? [message || SHARE_COPY.expiredTitle, message ? null : SHARE_COPY.expired]
        : [`${SHARE_COPY.retry} the report.`, 'Check your connection, then try again.'];
  return (
    <div className="mx-auto max-w-md pt-6 sm:pt-12">
      <Card className="p-6 text-center">
        <Logo size={24} className="justify-center" />
        <p className="mt-4 text-sm font-semibold text-fg">{title}</p>
        {body && <p className="mt-1 text-sm text-fg-muted">{body}</p>}
        {onRetry && (
          <Button variant="secondary" className="mt-4" onClick={onRetry}>
            Try again
          </Button>
        )}
      </Card>
    </div>
  );
}

function PoweredBy() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-5xl items-center justify-end gap-1.5 px-4 py-4 text-xs text-fg-muted">
        Powered by
        <LogoMark size={11} />
        <span className="font-semibold text-fg">Doorline</span>
      </div>
    </footer>
  );
}

export default function PublicReportLayout() {
  const { token } = useParams();
  const qc = useQueryClient();
  const session = useMemo(() => getShareSession(token), [token]);
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const { accessToken } = snap;

  // The page's own <title> (neutral until the password is right) and a noindex meta, both handed
  // back on unmount. The real indexing controls are server-side — `X-Robots-Tag: noindex, nofollow`
  // on /r/ pages and /api/share (§F6), with /r/ no longer disallowed in robots.txt, since a crawler
  // blocked there never sees a noindex. The meta covers a crawler that renders the page anyway.
  useEffect(() => {
    const previous = document.title;
    const tag = document.createElement('meta');
    tag.name = 'robots';
    tag.content = 'noindex, nofollow';
    document.head.appendChild(tag);
    return () => {
      document.title = previous;
      tag.remove();
    };
  }, []);

  // Meta: { requiresPassword } only. Refetched whenever the session drops, so a legacy open link
  // that gained a password shows the gate.
  const metaQ = useQuery({
    queryKey: ['share-meta', token],
    queryFn: ({ signal }) => session.get('', { signal }),
    retry: shareRetry,
  });
  const meta = metaQ.data;

  // The hub: names, the logo flag and the reports — behind the password. Re-read when the tab
  // comes back, so a page left open for a day learns what changed (a new report, a new password).
  const hubQ = useQuery({
    queryKey: ['share', token, accessToken, 'reports'],
    queryFn: ({ signal }) => session.get('/reports', { signal }),
    enabled: !!accessToken && !snap.fatal,
    retry: shareRetry,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const hub = hubQ.data || null;

  // A link to one report opens just that report (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D): its tab
  // says "Report"; a link to all your reports keeps "Reports".
  useEffect(() => {
    document.title = accessToken && hub?.campaignName ? `${hub.campaignName} · ${hub.single ? 'Report' : 'Reports'}` : 'Shared report';
  }, [accessToken, hub?.campaignName, hub?.single]);

  // A dropped session forgets everything read with it (door addresses included) and asks the link again.
  useEffect(() => {
    if (!snap.ends) return;
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'share-meta' && JSON.stringify(q.queryKey).includes(token) });
    qc.invalidateQueries({ queryKey: ['share-meta', token] });
  }, [snap.ends, qc, token]);

  // Another tab signed out (or in) with "Keep me signed in": follow it.
  useEffect(() => {
    const key = shareAccessKey(token);
    const onStorage = (e) => {
      if (e.key === null || e.key === key) session.syncFromStorage();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [session, token]);

  // A legacy open link (no password): fetch a token at once so every read works the same way. Not
  // after a 401 or a sign-out, which wait for the person.
  useEffect(() => {
    if (accessToken || snap.fatal || snap.gate || snap.unlocking || snap.unlockError) return;
    if (meta && meta.requiresPassword === false) session.unlock({});
  }, [meta, accessToken, snap.fatal, snap.gate, snap.unlocking, snap.unlockError, session]);

  // The org's logo, as a blob URL — fetched with the access token in a header (never in a URL),
  // revoked when it changes or the page goes. 204 means there is none.
  const [logo, setLogo] = useState(null);
  useEffect(() => {
    setLogo(null);
    if (!accessToken || !hub?.hasLogo) return undefined;
    const ctrl = new AbortController();
    let url = null;
    fetch(`/api/share/${token}/logo`, { headers: { 'X-Share-Token': accessToken }, signal: ctrl.signal, cache: 'no-store' })
      .then(async (res) => {
        if (res.status !== 200) return;
        const blob = await res.blob();
        if (ctrl.signal.aborted || !blob.size) return;
        url = URL.createObjectURL(blob);
        setLogo({ url, blob });
      })
      .catch(() => {});
    return () => {
      ctrl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [token, accessToken, hub?.hasLogo]);

  const signedIn = !!accessToken && !snap.fatal;
  const canSignOut = signedIn && meta?.requiresPassword !== false;

  let body;
  if (snap.fatal) {
    body = <ShareNotice kind={snap.fatal.kind} message={snap.fatal.message} />;
  } else if (signedIn) {
    body = (
      <Outlet
        context={{
          token,
          session,
          accessToken,
          hub,
          hubQ,
          logo: { url: logo?.url || null, blob: logo?.blob || null },
        }}
      />
    );
  } else if (metaQ.isLoading) {
    body = <Centered>Loading…</Centered>;
  } else if (metaQ.error) {
    // A dead or expired link became `fatal` in the handler; anything else can be tried again.
    body = classifyShareError(metaQ.error).kind === 'retry' ? <ShareNotice kind="retry" onRetry={() => metaQ.refetch()} /> : <Centered>Loading…</Centered>;
  } else if (meta?.requiresPassword === false && !snap.gate) {
    body = snap.unlockError ? <ShareNotice kind="retry" onRetry={() => session.unlock({})} /> : <Centered>Loading…</Centered>;
  } else {
    body = (
      <ShareGate
        reason={snap.gate}
        error={snap.unlockError}
        busy={snap.unlocking}
        requiresPassword={meta?.requiresPassword !== false}
        onSubmit={(creds) => session.unlock(creds)}
      />
    );
  }

  return (
    <div className="theme-light flex min-h-screen flex-col bg-surface text-fg">
      {signedIn && (
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
            {logo?.url && (
              <img src={logo.url} alt={hub?.orgName ? `${hub.orgName} logo` : 'Logo'} className="h-9 w-auto max-w-[140px] shrink-0 object-contain" />
            )}
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-semibold text-fg">{hub?.campaignName || ' '}</span>
              {hub?.orgName && <span className="truncate text-xs text-fg-muted">{hub.orgName}</span>}
            </span>
            {canSignOut && (
              <button
                type="button"
                onClick={() => session.signOut()}
                className="ml-auto shrink-0 rounded text-xs font-medium text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="hidden sm:inline">Sign out on this device</span>
                <span className="sm:hidden">Sign out</span>
              </button>
            )}
          </div>
        </header>
      )}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{body}</main>
      <PoweredBy />
    </div>
  );
}
