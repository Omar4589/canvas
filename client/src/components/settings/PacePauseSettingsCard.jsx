import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Card, Button } from '../ui';
import Segmented from '../ui/Segmented.jsx';
import { invalidatePaceCaches } from '../audit/PacePausePanel.jsx';
import RecipientPicker from './RecipientPicker.jsx';
import { saveIds, settingsChanged } from '../../lib/recipientPicker.js';

// The Settings page's "Automatic pause" card (docs/PROPOSAL_PACE_PAUSE.md §H; it lived on the Users page
// until docs/PROPOSAL_PEOPLE_PAGES.md §C moved it). Org admins see it; billing admins change it. On for every
// organization by default. "Billing admins (always)" stays a choice of its own, so a billing admin added
// later is included without anyone editing the list. Who else gets the email is RecipientPicker.

// The settings read, shared with the Settings page (its loading and error states observe the same query).
export const settingsQuery = {
  queryKey: ['admin', 'pace-pauses', 'settings'],
  queryFn: ({ signal }) => api('/admin/pace-pauses/settings', { signal }),
  retry: false,
};

export const PacePauseSettingsView = ({ s, draft, setDraft, saving, error, onSave }) => {
  const changed = settingsChanged(s, draft);
  const turningOff = s.enabled && !draft.enabled;
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

      <RecipientPicker s={s} draft={draft} setDraft={setDraft} />

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
  const q = useQuery(settingsQuery);
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
          // Only picks who can still be emailed: a stale one is dropped, instead of failing the save.
          alertUserIds: saveIds(s, current.alertUserIds),
        })
      }
    />
  );
};

export default PacePauseSettingsCard;
