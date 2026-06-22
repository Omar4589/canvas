import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import CampaignSelector, { useCampaignSelection } from '../components/CampaignSelector.jsx';
import { Button, Badge, Card } from '../components/ui/index.js';
import PasswordInput from '../components/PasswordInput.jsx';
import { formatWeekRange } from '../lib/datePresets.js';
import { formatDateInTz } from '../lib/datetime.js';

const STATUS_VARIANT = { draft: 'neutral', published: 'success', archived: 'warning' };

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}
function defaultWeek() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  return { weekStart: isoDay(start), weekEnd: isoDay(end) };
}

// Per-campaign public share links: create, copy, password, rotate, enable/disable, delete.
function SharePanel({ campaignId }) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(null);

  const q = useQuery({
    queryKey: ['admin', 'client-report-shares', campaignId],
    queryFn: () => api(`/admin/client-reports/shares?campaignId=${campaignId}`),
    enabled: !!campaignId,
  });
  const shares = q.data?.shares || [];
  const inval = () => qc.invalidateQueries({ queryKey: ['admin', 'client-report-shares', campaignId] });

  const createM = useMutation({
    mutationFn: (body) => api('/admin/client-reports/shares', { method: 'POST', body }),
    onSuccess: inval,
  });
  const patchM = useMutation({
    mutationFn: ({ id, body }) => api(`/admin/client-reports/shares/${id}`, { method: 'PATCH', body }),
    onSuccess: inval,
  });
  const rotateM = useMutation({
    mutationFn: (id) => api(`/admin/client-reports/shares/${id}/rotate`, { method: 'POST' }),
    onSuccess: inval,
  });
  const deleteM = useMutation({
    mutationFn: (id) => api(`/admin/client-reports/shares/${id}`, { method: 'DELETE' }),
    onSuccess: inval,
  });

  const urlFor = (token) => `${window.location.origin}/r/${token}`;
  function copy(token) {
    navigator.clipboard
      ?.writeText(urlFor(token))
      .then(() => {
        setCopied(token);
        setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => {});
  }
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-fg">Share link</div>
          <div className="text-xs text-fg-muted">
            A public link to this campaign's published reports (latest + history). Anyone with it can
            view — add a password and revoke/rotate any time.
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          loading={createM.isPending}
          disabled={!campaignId}
          onClick={() => createM.mutate({ campaignId })}
        >
          + New link
        </Button>
      </div>
      {q.isLoading && <div className="text-sm text-fg-muted">Loading…</div>}
      {!q.isLoading && shares.length === 0 && (
        <div className="text-sm text-fg-muted">No share link yet — create one to send to your client.</div>
      )}
      <div className="space-y-2">
        {shares.map((s) => (
          <ShareRow
            key={s.id}
            s={s}
            url={urlFor(s.token)}
            copied={copied === s.token}
            onCopy={() => copy(s.token)}
            patchM={patchM}
            rotateM={rotateM}
            deleteM={deleteM}
          />
        ))}
      </div>
    </Card>
  );
}

// One share-link row: editable label, copyable URL, inline password editor (no window.prompt),
// rotate / enable-disable / delete, and a "last opened" stamp. Per-row UI state lives here.
function ShareRow({ s, url, copied, onCopy, patchM, rotateM, deleteM }) {
  const [label, setLabel] = useState(s.label || '');
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');

  // Re-sync when the server value changes (after a save invalidates the list).
  useEffect(() => setLabel(s.label || ''), [s.label]);

  const saveLabel = () => {
    const next = label.trim();
    if (next === (s.label || '')) return; // only PATCH on a real change
    patchM.mutate({ id: s.id, body: { label: next } });
  };
  const savePassword = () => {
    if (!pw && s.hasPassword && !window.confirm('Remove the password from this link?')) return;
    patchM.mutate(
      { id: s.id, body: { password: pw || null } },
      {
        onSuccess: () => {
          setPwOpen(false);
          setPw('');
        },
      }
    );
  };

  return (
    <div className="rounded-lg border border-border p-3">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={saveLabel}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        placeholder="Label this link (e.g. Candidate, Internal)"
        className="mb-2 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-fg hover:border-border focus:border-brand-accent focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          className="min-w-0 flex-1 rounded border border-border bg-sunken px-2 py-1.5 text-xs text-fg-muted"
        />
        <Button size="sm" variant="secondary" onClick={onCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </Button>
        {!s.isActive && <Badge variant="neutral">disabled</Badge>}
        {s.hasPassword && (
          <Badge variant="info" dot>
            password
          </Badge>
        )}
      </div>

      {pwOpen && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <PasswordInput
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder={s.hasPassword ? 'New password (blank removes it)' : 'Set a password'}
              autoComplete="new-password"
            />
          </div>
          <Button size="sm" loading={patchM.isPending} onClick={savePassword}>
            Save
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setPwOpen(false);
              setPw('');
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <button type="button" className="text-brand-accent hover:underline" onClick={() => setPwOpen((v) => !v)}>
          {s.hasPassword ? 'Change password' : 'Set password'}
        </button>
        {s.hasPassword && (
          <button
            type="button"
            className="text-fg-muted hover:underline"
            onClick={() => patchM.mutate({ id: s.id, body: { password: null } })}
          >
            Remove password
          </button>
        )}
        <button
          type="button"
          className="text-fg-muted hover:underline"
          onClick={() => {
            if (window.confirm('Rotate this link? The current URL stops working.')) rotateM.mutate(s.id);
          }}
        >
          Rotate
        </button>
        <button
          type="button"
          className="text-fg-muted hover:underline"
          onClick={() => patchM.mutate({ id: s.id, body: { isActive: !s.isActive } })}
        >
          {s.isActive ? 'Disable' : 'Enable'}
        </button>
        <button
          type="button"
          className="text-danger hover:underline"
          onClick={() => {
            if (window.confirm('Delete this share link?')) deleteM.mutate(s.id);
          }}
        >
          Delete
        </button>
        {s.lastAccessedAt && (
          <span className="ml-auto text-fg-subtle">Last opened {formatDateInTz(s.lastAccessedAt)}</span>
        )}
      </div>
    </div>
  );
}

export default function ClientReportsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { campaignId, setCampaignId, campaigns, isLoading: campaignsLoading } = useCampaignSelection();

  const [form, setForm] = useState(() => ({ title: '', ...defaultWeek() }));
  const [error, setError] = useState(null);

  const reportsQ = useQuery({
    queryKey: ['admin', 'client-reports', campaignId],
    queryFn: () => api(`/admin/client-reports?campaignId=${campaignId}`),
    enabled: !!campaignId,
  });

  const createM = useMutation({
    mutationFn: (body) => api('/admin/client-reports', { method: 'POST', body }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'client-reports', campaignId] });
      navigate(`/admin/client-reports/${res.report._id}`);
    },
    onError: (e) => setError(e.message),
  });

  const deleteM = useMutation({
    mutationFn: (id) => api(`/admin/client-reports/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['admin', 'client-reports', campaignId] }),
  });

  function submit(e) {
    e.preventDefault();
    setError(null);
    if (!campaignId) return setError('Pick a campaign first.');
    if (form.weekStart > form.weekEnd) return setError('Week start must be on or before week end.');
    createM.mutate({
      campaignId,
      weekStart: form.weekStart,
      weekEnd: form.weekEnd,
      title: form.title || undefined,
    });
  }

  const reports = reportsQ.data?.reports || [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">Client Reports</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Build and publish weekly snapshots, then share a link with your client.
          </p>
        </div>
        <CampaignSelector
          campaignId={campaignId}
          onChange={setCampaignId}
          campaigns={campaigns}
          isLoading={campaignsLoading}
        />
      </div>

      {campaignId && <SharePanel campaignId={campaignId} />}

      <Card className="p-4">
        <div className="mb-3 text-sm font-semibold text-fg">New weekly report</div>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Title (optional)
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Week of June 1"
              className="rounded border border-border bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Week start
            <input
              type="date"
              value={form.weekStart}
              onChange={(e) => setForm((f) => ({ ...f, weekStart: e.target.value }))}
              className="rounded border border-border bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Week end
            <input
              type="date"
              value={form.weekEnd}
              onChange={(e) => setForm((f) => ({ ...f, weekEnd: e.target.value }))}
              className="rounded border border-border bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none"
            />
          </label>
          <Button type="submit" loading={createM.isPending} disabled={!campaignId}>
            Create draft
          </Button>
        </form>
        {error && <div className="mt-2 text-sm text-danger">{error}</div>}
      </Card>

      <div className="space-y-2">
        {reportsQ.isLoading && <div className="text-sm text-fg-muted">Loading reports…</div>}
        {!reportsQ.isLoading && reports.length === 0 && (
          <Card className="p-6 text-sm text-fg-muted">No reports yet for this campaign.</Card>
        )}
        {reports.map((r) => (
          <Card key={r.id} className="flex items-center justify-between gap-3 p-4">
            <button
              type="button"
              onClick={() => navigate(`/admin/client-reports/${r.id}`)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-fg">
                  {r.title || formatWeekRange(r.weekStart, r.weekEnd)}
                </span>
                <Badge variant={STATUS_VARIANT[r.status] || 'neutral'} dot>
                  {r.status}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-fg-muted">
                {formatWeekRange(r.weekStart, r.weekEnd)} ·{' '}
                {(r.headline?.cumulative?.doorsKnocked || 0).toLocaleString()} doors ·{' '}
                {(r.headline?.cumulative?.surveysTaken || 0).toLocaleString()} surveys
                {r.status === 'published' && ` · ${(r.mapPointCount || 0).toLocaleString()} map points`}
                {r.status === 'published' &&
                  (r.viewCount > 0
                    ? ` · Viewed ${r.viewCount.toLocaleString()}× · last ${formatDateInTz(r.lastViewedAt, r.timeZone)}`
                    : ' · Not viewed yet')}
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => navigate(`/admin/client-reports/${r.id}`)}>
                Open
              </Button>
              <Button
                size="sm"
                variant="danger"
                loading={deleteM.isPending && deleteM.variables === r.id}
                onClick={() => {
                  if (window.confirm('Delete this report? This cannot be undone.')) deleteM.mutate(r.id);
                }}
              >
                Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
