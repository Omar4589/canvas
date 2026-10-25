import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Badge, Button, Card, Modal, Select } from '../ui/index.js';
import PasswordInput from '../PasswordInput.jsx';
import RowMenu from '../RowMenu.jsx';
import { formatDateInTz } from '../../lib/datetime.js';
import {
  DEFAULT_EXPIRY_DAYS,
  EXPIRY_CHOICES,
  PASSWORD_MIN,
  disableConfirmText,
  extendChoices,
  failureLine,
  isExpired,
  isLocked,
  linkBadges,
  renewText,
  rotateConfirmLines,
  shareUrl,
  shortUrl,
} from './linkState.js';
import { linkMessageFor } from './copyMessage.js';
import { ConfirmDialog, ErrorBanner } from './parts.jsx';
import { historyKey, sharesKey, useCopy } from './hooks.js';

// Client links (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F6, §G7, §O7). One client per campaign, so
// links are per campaign; each opens every report shown on it. A link has a password (a generated one
// is shown ONCE), an expiry chosen at creation (30 days to a year), and a one-year life it can be
// extended within. An expired link is RENEWED — a new address, so a URL forwarded long ago stays dead —
// and never offered Rotate, which keeps the expiry (ADMINUX-8).
// A password change, rotate or disable signs everyone out. Fifty wrong passwords in a day lock it;
// devices already signed in keep working, and the panel says to rotate (50 is never the client).

const DAY_MS = 24 * 60 * 60 * 1000;
const untilLabel = (days, tz) => formatDateInTz(new Date(Date.now() + days * DAY_MS), tz);

const ClientLinksPanel = ({ campaignId, tz }) => {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: sharesKey(campaignId),
    queryFn: () => api(`/admin/client-reports/shares?campaignId=${campaignId}`),
    enabled: !!campaignId,
  });
  const shares = q.data?.shares || [];
  const [creating, setCreating] = useState(false);
  const [ready, setReady] = useState(null); // { share, generatedPassword }
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: sharesKey(campaignId) });
    qc.invalidateQueries({ queryKey: historyKey(campaignId) });
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">Client links</h2>
          <p className="mt-0.5 text-xs text-fg-muted">Each link opens every report you’ve put up. Send the link and its password separately.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          + New link
        </Button>
      </div>
      {q.isLoading && <p className="text-sm text-fg-muted">Loading links…</p>}
      {q.isError && <ErrorBanner title="Couldn’t load the links." error={q.error} />}
      {!q.isLoading && !q.isError && shares.length === 0 && (
        <p className="text-sm text-fg-muted">No link yet — create one to send to your client.</p>
      )}
      <ul className="space-y-3">
        {shares.map((s) => (
          <LinkRow key={s.id} share={s} tz={tz} onChanged={invalidate} />
        ))}
      </ul>
      {creating && (
        <NewLinkDialog
          campaignId={campaignId}
          tz={tz}
          onClose={() => setCreating(false)}
          onCreated={(res) => {
            setCreating(false);
            setReady(res);
            invalidate();
          }}
        />
      )}
      {ready && <LinkReadyDialog share={ready.share} password={ready.generatedPassword || null} onClose={() => setReady(null)} />}
    </Card>
  );
};

// ── One link ──────────────────────────────────────────────────────────────────────────────────────

const LinkRow = ({ share: s, tz, onChanged }) => {
  const now = Date.now();
  const url = shareUrl(window.location.origin, s.token);
  const { copied, copy } = useCopy();
  const [label, setLabel] = useState(s.label || '');
  const [panel, setPanel] = useState(null); // 'password' | 'extend' | 'renew' | null
  const [confirm, setConfirm] = useState(null); // 'rotate' | 'disable' | 'delete' | null
  const [error, setError] = useState(null);
  useEffect(() => setLabel(s.label || ''), [s.label]);

  const act = useMutation({
    mutationFn: ({ path = '', method = 'POST', body }) => api(`/admin/client-reports/shares/${s.id}${path}`, { method, body }),
    onSuccess: () => {
      setError(null);
      setConfirm(null);
      setPanel(null);
      onChanged();
    },
    onError: setError,
  });
  const expired = isExpired(s, now);
  // An expired link is only ever renewed (ADMINUX-8): Renew already gives it a new address, a new year
  // and a clear wrong-password count, while Rotate keeps the expiry — its new address would be dead on
  // arrival — and Unlock would clear a lock on a link nobody can open.
  const locked = !expired && isLocked(s, now);
  const badges = linkBadges(s, { now, tz });
  const failures = failureLine(s.failures, tz);

  const saveLabel = () => {
    const next = label.trim();
    if (next === (s.label || '')) return;
    act.mutate({ method: 'PATCH', body: { label: next } });
  };

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex items-start gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={saveLabel}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          maxLength={120}
          aria-label="Link label"
          placeholder="Label this link (e.g. Candidate)"
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-fg hover:border-border focus:border-brand-accent focus:outline-none"
        />
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {badges.map((b) => (
            <Badge key={b.key} variant={b.variant} dot>
              {b.label}
            </Badge>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded border border-border bg-sunken px-2 py-1 text-xs text-fg-muted" title={url}>
          {shortUrl(url)}
        </code>
        <Button size="sm" variant="secondary" onClick={() => copy(url, 'url')} disabled={expired || !s.isActive}>
          {copied === 'url' ? 'Copied!' : 'Copy'}
        </Button>
      </div>

      {/* What each badge means, in a sentence — the badges alone don't say what to do. Then the wrong
          passwords, muted, whenever there are any — the day, the week and the total — on a locked or
          expired link too; the warning badge alone is for the last 24 hours (WALK-2). */}
      <div className="mt-2 space-y-1 text-xs">
        {badges
          .filter((b) => b.detail)
          .map((b) => (
            <p key={b.key} className={b.variant === 'danger' ? 'text-danger-fg' : b.variant === 'warning' ? 'text-warning-fg' : 'text-fg-muted'}>
              {b.detail}
            </p>
          ))}
        {failures && <p className="text-fg-muted">{failures}.</p>}
        {locked && s.rotateAdvice !== false && (
          <p className="text-danger-fg">Someone else has this link — 50 wrong passwords is never your client. Rotate it.</p>
        )}
        {!locked && !expired && s.rotateAdvice && (
          <p className="text-warning-fg">50 or more wrong passwords this week — someone else may have this link. Rotate it.</p>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
        {s.expiresAt && !expired && <span>Expires {formatDateInTz(s.expiresAt, tz)}</span>}
        {s.expiresAt && expired && <span>Expired {formatDateInTz(s.expiresAt, tz)}</span>}
        <span>{s.lastAccessedAt ? `Last opened ${formatDateInTz(s.lastAccessedAt, tz)}` : 'Not opened yet'}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {expired ? (
          <Button size="sm" onClick={() => setPanel(panel === 'renew' ? null : 'renew')}>
            Renew
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setPanel(panel === 'extend' ? null : 'extend')}>
            {s.expiresAt ? 'Extend' : 'Set an expiry'}
          </Button>
        )}
        {locked && (
          <Button size="sm" variant="secondary" loading={act.isPending && act.variables?.path === '/unlock'} onClick={() => act.mutate({ path: '/unlock' })}>
            Unlock now
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => setPanel(panel === 'password' ? null : 'password')}>
          {s.hasPassword === false ? 'Add a password' : 'Change password'}
        </Button>
        {!expired && (
          <Button size="sm" variant={locked || s.rotateAdvice ? 'primary' : 'ghost'} onClick={() => setConfirm('rotate')}>
            Rotate
          </Button>
        )}
        <span className="ml-auto">
          <RowMenu
            items={[
              s.isActive
                ? { label: 'Disable', onClick: () => setConfirm('disable') }
                : { label: 'Enable', onClick: () => act.mutate({ method: 'PATCH', body: { isActive: true } }) },
              { label: 'Delete', danger: true, onClick: () => setConfirm('delete') },
            ]}
          />
        </span>
      </div>

      {error && !confirm && (
        <div className="mt-2">
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {panel === 'password' && <PasswordPanel share={s} busy={act.isPending} onCancel={() => setPanel(null)} onSave={(password) => act.mutate({ method: 'PATCH', body: { password } })} />}
      {panel === 'extend' && <ExtendPanel share={s} tz={tz} busy={act.isPending} onCancel={() => setPanel(null)} onPick={(days) => act.mutate({ path: '/extend', body: { expiresInDays: days } })} />}
      {panel === 'renew' && <RenewPanel share={s} tz={tz} busy={act.isPending} onCancel={() => setPanel(null)} onRenew={(days) => act.mutate({ path: '/renew', body: { expiresInDays: days } })} />}

      {/* Each confirm says what the server does (linkState.js words them, from the share routes). */}
      {confirm === 'rotate' && (
        <ConfirmDialog
          title="Rotate this link?"
          confirmLabel="Rotate"
          busy={act.isPending}
          error={act.error}
          onClose={() => setConfirm(null)}
          onConfirm={() => act.mutate({ path: '/rotate' })}
        >
          {rotateConfirmLines(s, { now, tz }).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </ConfirmDialog>
      )}
      {confirm === 'disable' && (
        <ConfirmDialog
          title="Disable this link?"
          confirmLabel="Disable"
          danger
          busy={act.isPending}
          error={act.error}
          onClose={() => setConfirm(null)}
          onConfirm={() => act.mutate({ method: 'PATCH', body: { isActive: false } })}
        >
          <p>{disableConfirmText(s)}</p>
        </ConfirmDialog>
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          title="Delete this link?"
          confirmLabel="Delete link"
          danger
          busy={act.isPending}
          error={act.error}
          onClose={() => setConfirm(null)}
          onConfirm={() => act.mutate({ method: 'DELETE' })}
        >
          <p>Anyone using it loses access for good. This can’t be undone.</p>
        </ConfirmDialog>
      )}
    </li>
  );
};

const PasswordPanel = ({ share, busy, onCancel, onSave }) => {
  const [pw, setPw] = useState('');
  const [touched, setTouched] = useState(false);
  const short = pw.trim().length < PASSWORD_MIN;
  // A link that never expires (a legacy one) gains an expiry with its password (the PATCH route).
  const gainsExpiry = !!share && !share.expiresAt;
  return (
    <form
      className="mt-2 space-y-2 rounded-md border border-border bg-sunken/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!short) onSave(pw.trim());
      }}
    >
      <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} placeholder={`New password (${PASSWORD_MIN}+ characters)`} autoComplete="new-password" />
      <p className={`text-xs ${touched && short ? 'text-danger-fg' : 'text-fg-muted'}`}>
        {touched && short
          ? `Use at least ${PASSWORD_MIN} characters.`
          : `${PASSWORD_MIN} or more characters. Changing it signs everyone out — send your client the new password.${gainsExpiry ? ' The link also gets an expiry date, which you can extend.' : ''}`}
      </p>
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={busy}>
          Save password
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

// Extend shows the resulting date and offers only later ones, up to a year from when the link was
// made (§G7). It never shortens a link.
const ExtendPanel = ({ share, tz, busy, onCancel, onPick }) => {
  const choices = extendChoices(share);
  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-sunken/60 p-3">
      {choices.length === 0 ? (
        <p className="text-xs text-fg-muted">
          This link already lasts as long as it can — a year from when it was made. When it expires, Renew gives it a new address and a new year.
        </p>
      ) : (
        <>
          <p className="text-xs text-fg-muted">Make it last until:</p>
          <div className="flex flex-wrap gap-1.5">
            {choices.map((c) => (
              <Button key={c.days} size="sm" variant="secondary" disabled={busy} onClick={() => onPick(c.days)}>
                {formatDateInTz(c.until, tz)}
                {c.capped ? ' (a year from when it was made)' : ` (${c.days} days)`}
              </Button>
            ))}
          </div>
        </>
      )}
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Close
      </Button>
    </div>
  );
};

const RenewPanel = ({ share, tz, busy, onCancel, onRenew }) => {
  const [days, setDays] = useState(DEFAULT_EXPIRY_DAYS);
  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-sunken/60 p-3">
      <p className="text-xs text-fg-muted">{renewText(share)}</p>
      <label className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        Lasts
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="py-1 text-xs">
          {EXPIRY_CHOICES.map((d) => (
            <option key={d} value={d}>
              {d} days — until {untilLabel(d, tz)}
            </option>
          ))}
        </Select>
      </label>
      <div className="flex gap-2">
        <Button size="sm" loading={busy} onClick={() => onRenew(days)}>
          Renew link
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

// ── New link, and the one time its password is shown ─────────────────────────────────────────────

const NewLinkDialog = ({ campaignId, tz, onClose, onCreated }) => {
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(DEFAULT_EXPIRY_DAYS);
  const [mode, setMode] = useState('generate');
  const [pw, setPw] = useState('');
  const [touched, setTouched] = useState(false);
  const create = useMutation({
    mutationFn: (body) => api('/admin/client-reports/shares', { method: 'POST', body }),
    onSuccess: onCreated,
  });
  const short = mode === 'own' && pw.trim().length < PASSWORD_MIN;
  const submit = () => {
    setTouched(true);
    if (short) return;
    create.mutate({
      campaignId,
      label: label.trim() || undefined,
      expiresInDays: days,
      ...(mode === 'own' ? { password: pw.trim() } : {}),
    });
  };
  return (
    <Modal
      size="md"
      title="New client link"
      onClose={create.isPending ? undefined : onClose}
      closable={!create.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button loading={create.isPending} onClick={submit}>
            Create link
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="text-xs font-medium text-fg-muted">Label (only you see it)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={120}
            placeholder="e.g. Candidate"
            className="mt-1 w-full rounded-lg border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-fg-muted">Expires</span>
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="mt-1 w-full">
            {EXPIRY_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d} days — until {untilLabel(d, tz)}
              </option>
            ))}
          </Select>
          <span className="mt-1 block text-xs text-fg-muted">You can extend it later, up to a year from today.</span>
        </label>
        <fieldset>
          <legend className="text-xs font-medium text-fg-muted">Password</legend>
          <label className="mt-1 flex items-center gap-2">
            <input type="radio" className="accent-brand-accent" checked={mode === 'generate'} onChange={() => setMode('generate')} />
            Generate a strong one (shown once)
          </label>
          <label className="mt-1 flex items-center gap-2">
            <input type="radio" className="accent-brand-accent" checked={mode === 'own'} onChange={() => setMode('own')} />
            Set my own
          </label>
          {mode === 'own' && (
            <div className="mt-2">
              <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} placeholder={`${PASSWORD_MIN}+ characters`} autoComplete="new-password" />
              <p className={`mt-1 text-xs ${touched && short ? 'text-danger-fg' : 'text-fg-muted'}`}>
                {touched && short ? `Use at least ${PASSWORD_MIN} characters.` : `${PASSWORD_MIN} or more characters.`}
              </p>
            </div>
          )}
        </fieldset>
        {create.error && <ErrorBanner title="Couldn’t create the link." error={create.error} />}
      </div>
    </Modal>
  );
};

const LinkReadyDialog = ({ share, password, onClose }) => {
  const { copied, copy } = useCopy();
  const url = shareUrl(window.location.origin, share.token);
  return (
    <Modal
      size="md"
      title="Link ready"
      subtitle="Send the link and the password separately."
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-4 text-sm">
        <div>
          <div className="text-xs font-medium text-fg-muted">Link</div>
          {/* The whole address, wrapped, with the buttons below it: one line beside two buttons left
              a phone just "http://127.…" of it. */}
          <code className="mt-1 block break-all rounded border border-border bg-sunken px-2 py-1 text-xs text-fg">{url}</code>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => copy(url, 'url')}>
              {copied === 'url' ? 'Copied!' : 'Copy link'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => copy(linkMessageFor({ link: share, origin: window.location.origin }), 'msg')}>
              {copied === 'msg' ? 'Copied!' : 'Copy message'}
            </Button>
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-fg-muted">Password</div>
          {password ? (
            <>
              <div className="mt-1 flex items-center gap-2">
                <code className="rounded border border-border bg-sunken px-2 py-1 text-sm font-medium text-fg">{password}</code>
                <Button size="sm" variant="secondary" onClick={() => copy(password, 'pw')}>
                  {copied === 'pw' ? 'Copied!' : 'Copy'}
                </Button>
              </div>
              <p className="mt-1 text-xs text-warning-fg">Shown once. Lost it? Change password on the link.</p>
            </>
          ) : (
            <p className="mt-1 text-xs text-fg-muted">The one you set. It isn’t shown again.</p>
          )}
        </div>
        {String(copied || '').endsWith(':failed') && <p className="text-xs text-danger-fg">Couldn’t copy — select the text and copy it yourself.</p>}
      </div>
    </Modal>
  );
};

export default ClientLinksPanel;
