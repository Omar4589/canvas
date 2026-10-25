import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getActiveOrgId, getToken } from '../../api/client.js';
import { Button, Card } from '../ui/index.js';
import { ConfirmDialog, ErrorBanner } from './parts.jsx';
import { brandingKey } from './hooks.js';
import { logoErrorText, logoToPng } from './logoImage.js';

// Report branding (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F8, §G8): the organization's logo on the
// client's page and PDF, with a small "Powered by Doorline". Org-wide, so admins change it (owner
// ruling 10-23); leads see it read-only — "Set by an admin", or "No logo yet". Any image is accepted
// here and converted to a clean PNG in the browser (logoImage.js) before it is sent.

const authHeaders = () => {
  const headers = {};
  const token = getToken();
  const orgId = getActiveOrgId();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['X-Org-Id'] = orgId;
  return headers;
};

/** The logo as a data URL for the PDF (jsPDF's addImage), or null when there is none or it fails. */
export const fetchLogoDataUrl = async () => {
  try {
    const res = await fetch('/api/admin/branding/logo', { headers: authHeaders() });
    if (!res.ok || res.status === 204) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

/** The logo as an object URL, fetched with the signed-in session; revoked when it changes or the card goes. */
export const useLogoUrl = (version) => {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!version) {
      setUrl(null);
      return undefined;
    }
    const ctrl = new AbortController();
    let made = null;
    fetch('/api/admin/branding/logo', { headers: authHeaders(), signal: ctrl.signal })
      .then((res) => (res.ok && res.status !== 204 ? res.blob() : null))
      .then((blob) => {
        if (!blob || ctrl.signal.aborted) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => {});
    return () => {
      ctrl.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [version]);
  return url;
};

const BrandingCard = ({ isAdmin }) => {
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const [error, setError] = useState(null);
  const [converting, setConverting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const q = useQuery({ queryKey: brandingKey, queryFn: () => api('/admin/branding') });
  const info = q.data || null;
  const logoUrl = useLogoUrl(info?.hasLogo ? String(info.updatedAt || 'logo') : null);

  const upload = useMutation({
    mutationFn: (blob) => {
      const formData = new FormData();
      formData.append('logo', blob, 'logo.png');
      return api('/admin/branding/logo', { method: 'PUT', formData });
    },
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: brandingKey });
    },
    onError: (e) =>
      setError(
        e.status === 413
          ? 'That logo is still too large for the server. Try a smaller image.'
          : e.status === 400
            ? e.message || 'That image couldn’t be used. Try a PNG or JPEG.'
            : e.message || 'Couldn’t upload the logo — try again.'
      ),
  });
  const remove = useMutation({
    mutationFn: () => api('/admin/branding/logo', { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmRemove(false);
      qc.invalidateQueries({ queryKey: brandingKey });
    },
  });

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setConverting(true);
    try {
      const { blob } = await logoToPng(file);
      upload.mutate(blob);
    } catch (err) {
      setError(logoErrorText(err));
    } finally {
      setConverting(false);
    }
  };

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg">Report branding</h2>
      <p className="mt-0.5 text-xs text-fg-muted">Your logo sits at the top of your client’s reports and PDFs, with a small “Powered by Doorline”.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex h-16 w-40 items-center justify-center overflow-hidden rounded-md border border-border bg-sunken">
          {logoUrl ? (
            <img src={logoUrl} alt="Your organization’s logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="px-2 text-center text-xs text-fg-subtle">{q.isLoading ? 'Loading…' : 'No logo yet'}</span>
          )}
        </div>
        {isAdmin ? (
          <div className="flex flex-wrap gap-1.5">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" className="hidden" onChange={onFile} />
            <Button size="sm" variant="secondary" loading={converting || upload.isPending} onClick={() => fileRef.current?.click()}>
              {info?.hasLogo ? 'Change' : 'Upload'}
            </Button>
            {info?.hasLogo && (
              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
                Remove
              </Button>
            )}
          </div>
        ) : (
          <p className="text-xs text-fg-muted">{info?.hasLogo ? 'Set by an admin.' : 'No logo yet. An admin can add one.'}</p>
        )}
      </div>
      {isAdmin && <p className="mt-2 text-xs text-fg-muted">Any image works — it’s converted to a PNG up to 800 × 320 in your browser before it’s sent.</p>}
      {q.isError && <div className="mt-2"><ErrorBanner title="Couldn’t load the logo." error={q.error} /></div>}
      {error && (
        <div className="mt-2">
          <ErrorBanner title="Couldn’t use that image." onDismiss={() => setError(null)}>
            {error}
          </ErrorBanner>
        </div>
      )}
      {confirmRemove && (
        <ConfirmDialog
          title="Remove the logo?"
          confirmLabel="Remove"
          danger
          busy={remove.isPending}
          error={remove.error}
          onClose={() => setConfirmRemove(false)}
          onConfirm={() => remove.mutate()}
        >
          <p>Every report, on every campaign, shows without a logo until you upload one again.</p>
        </ConfirmDialog>
      )}
    </Card>
  );
};

export default BrandingCard;
