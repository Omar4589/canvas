import { useEffect, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { getShareAccess, setShareAccess } from '../lib/shareAccess.js';
import Logo from './Logo.jsx';
import PasswordInput from './PasswordInput.jsx';
import { Button, Card } from './ui/index.js';

function Centered({ children }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center px-4 text-sm text-fg-muted">
      {children}
    </div>
  );
}

// Public shell for a shared report hub (/r/:token). Fetches the link's meta (campaign/org name +
// whether a password is needed), shows a password gate when required, and hands the unlock token to
// the report pages via Outlet context. No login, no account chrome.
export default function PublicReportLayout() {
  const { token } = useParams();
  const [accessToken, setAccessToken] = useState(() => getShareAccess(token));
  const [pw, setPw] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Campaign Reports';
  }, []);

  const metaQ = useQuery({
    queryKey: ['share-meta', token],
    queryFn: () => api(`/share/${token}`, { public: true }),
    retry: false,
  });
  const meta = metaQ.data;

  // Open links (no password): auto-issue an access token once so the read flow is uniform.
  useEffect(() => {
    if (meta && !meta.requiresPassword && !accessToken) {
      api(`/share/${token}/unlock`, { method: 'POST', public: true })
        .then((r) => {
          setShareAccess(token, r.accessToken);
          setAccessToken(r.accessToken);
        })
        .catch(() => {});
    }
  }, [meta, accessToken, token]);

  async function unlock(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await api(`/share/${token}/unlock`, {
        method: 'POST',
        public: true,
        body: { password: pw },
      });
      setShareAccess(token, r.accessToken);
      setAccessToken(r.accessToken);
      setPw('');
    } catch (err) {
      setError(err.message || 'Incorrect password');
    } finally {
      setSubmitting(false);
    }
  }

  if (metaQ.isLoading) return <Centered>Loading…</Centered>;
  if (metaQ.isError) return <Centered>This report link is not available.</Centered>;

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-2.5 px-4 py-3">
          <Logo size={24} />
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-fg">{meta.campaignName}</span>
            {meta.orgName && <span className="text-xs text-fg-muted">{meta.orgName}</span>}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {accessToken ? (
          <Outlet context={{ token, accessToken, meta }} />
        ) : meta.requiresPassword ? (
          <div className="mx-auto max-w-sm pt-10">
            <Card as="form" onSubmit={unlock} className="p-6">
              <div className="mb-1 text-sm font-semibold text-fg">This report is password protected</div>
              <div className="mb-3 text-xs text-fg-muted">Enter the password you were given to view it.</div>
              <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" required />
              {error && <div className="mt-2 text-sm text-danger">{error}</div>}
              <Button type="submit" loading={submitting} className="mt-4 w-full">
                View report
              </Button>
            </Card>
          </div>
        ) : (
          <Centered>Loading…</Centered>
        )}
      </main>
    </div>
  );
}
