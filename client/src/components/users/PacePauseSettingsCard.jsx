import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Card, Button } from '../ui';
import Segmented from '../ui/Segmented.jsx';
import { invalidatePaceCaches } from '../audit/PacePausePanel.jsx';

// The Users page's "Automatic pause" card (docs/PROPOSAL_PACE_PAUSE.md §H). Org admins see it; billing admins
// change it. On for every organization by default. "Billing admins (always)" stays a choice of its own, so a
// billing admin added later is included without anyone editing the list.
const ROLE = { admin: 'Org admin', lead: 'Team lead' };

export const PacePauseSettingsView = ({ s, draft, setDraft, saving, error, onSave }) => {
  const changed =
    draft.enabled !== s.enabled ||
    draft.billingAdmins !== s.billingAdmins ||
    [...draft.alertUserIds].sort().join() !== [...s.alertUserIds].sort().join();
  const turningOff = s.enabled && !draft.enabled;
  const toggleUser = (id) =>
    setDraft((d) => ({ ...d, alertUserIds: d.alertUserIds.includes(id) ? d.alertUserIds.filter((x) => x !== id) : [...d.alertUserIds, id] }));
  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-base font-semibold text-fg">Automatic pause</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Doorline pauses a canvasser&apos;s recording when their doors come in faster than anyone could knock them —
            for example, doors saved from a moving car, or several saved at once from one spot. Nothing they saved is
            removed; someone on your team reviews the doors on the Audit page and unpauses them.
          </p>
          {!s.live && <p className="mt-1 text-sm font-medium text-fg">Automatic pause isn&apos;t running for your organization right now.</p>}
        </div>
        <Segmented
          value={draft.enabled ? 'on' : 'off'}
          onChange={(v) => s.canEdit && setDraft((d) => ({ ...d, enabled: v === 'on' }))}
          options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
          size="sm"
        />
      </div>

      <div className="mt-4">
        <p className="text-sm font-medium text-fg">Who gets the email</p>
        <p className="text-xs text-fg-muted">
          It names no one and lists no addresses; the details are on the Audit page. A team lead only gets it for
          campaigns they manage — and a team lead may be your client.
        </p>
        <ul className="mt-2 space-y-1.5">
          <li>
            <label className="inline-flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                disabled={!s.canEdit}
                checked={draft.billingAdmins}
                onChange={(e) => setDraft((d) => ({ ...d, billingAdmins: e.target.checked }))}
                className="h-4 w-4 rounded border-border-strong text-brand-accent"
              />
              Billing admins (always)
            </label>
          </li>
          {s.eligible.map((p) => (
            <li key={p.userId}>
              <label className="inline-flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  disabled={!s.canEdit}
                  checked={draft.alertUserIds.includes(p.userId)}
                  onChange={() => toggleUser(p.userId)}
                  className="h-4 w-4 rounded border-border-strong text-brand-accent"
                />
                {p.name}
                <span className="text-xs text-fg-muted">{ROLE[p.role] || p.role}{p.billingAdmin ? ' · billing admin' : ''}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      {turningOff && s.openPauses > 0 && (
        <p className="mt-3 text-sm text-warning-fg">
          Turning it off unpauses {s.openPauses} {s.openPauses === 1 ? 'canvasser' : 'canvassers'} right away.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex items-center gap-3">
        {s.canEdit ? (
          <Button onClick={onSave} disabled={!changed || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        ) : (
          <p className="text-xs text-fg-muted">Only a billing admin can change this.</p>
        )}
        {s.changedAt && s.changedByName && (
          <p className="text-xs text-fg-subtle">Last changed by {s.changedByName}</p>
        )}
      </div>
    </Card>
  );
};

const PacePauseSettingsCard = () => {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'pace-pauses', 'settings'], queryFn: () => api('/admin/pace-pauses/settings'), retry: false });
  const [draft, setDraft] = useState(null);
  const s = q.data;
  const current = draft ?? (s ? { enabled: s.enabled, billingAdmins: s.billingAdmins, alertUserIds: s.alertUserIds } : null);
  const save = useMutation({
    mutationFn: (body) => api('/admin/pace-pauses/settings', { method: 'PATCH', body }),
    onSuccess: (next) => {
      qc.setQueryData(['admin', 'pace-pauses', 'settings'], next);
      setDraft(null);
      invalidatePaceCaches(qc);
    },
  });
  if (!s || !current) return null;
  return (
    <PacePauseSettingsView
      s={s}
      draft={current}
      setDraft={(fn) => setDraft((d) => (typeof fn === 'function' ? fn(d ?? current) : fn))}
      saving={save.isPending}
      error={save.error?.message || ''}
      onSave={() =>
        save.mutate({
          ...(current.enabled !== s.enabled ? { enabled: current.enabled } : {}),
          billingAdmins: current.billingAdmins,
          alertUserIds: current.alertUserIds,
        })
      }
    />
  );
};

export default PacePauseSettingsCard;
