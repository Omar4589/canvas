import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Section from '../components/Section.jsx';
import { Button, Modal } from '../components/ui/index.js';
import PhonePreview from '../components/outcomes/PhonePreview.jsx';
import ReclassifyCard from '../components/outcomes/ReclassifyCard.jsx';
import { STATUS_COLORS, ACTION_LABELS } from '../lib/statusColors.js';
import { OUTCOME_HINTS } from '../lib/outcomeToggles.js';
import { useCurrentCampaign } from '../lib/useCurrentCampaign.js';
import { CampaignLoading, CampaignMissing } from '../components/campaigns/CampaignGate.jsx';

// Door-screen order, not TOGGLEABLE_OUTCOMES order — the list should read the way canvassers
// see the buttons. Lit-drop campaigns only get the two "signage" outcomes: wrong-address and
// refused don't exist in the lit-drop door UI (their routes are survey-gated), so showing
// their toggles would be dead switches.
const TOGGLE_ORDER = {
  survey: ['wrong_address', 'refused', 'no_soliciting', 'restricted'],
  lit_drop: ['no_soliciting', 'restricted'],
};
// Always-available outcomes per type, shown read-only so the page answers "what CAN'T I turn
// off?" instead of leaving it implied. not_home is survey-only: a lit-drop walk never records it.
const ALWAYS_ON_ROWS = {
  survey: [
    { key: 'not_home', dot: 'not_home', hint: "The default outcome — nobody answered. Also the door list's one-tap button." },
    { key: 'survey_submitted', dot: 'surveyed', hint: 'The completion action for survey campaigns.' },
  ],
  lit_drop: [
    { key: 'lit_dropped', dot: 'lit_dropped', hint: 'The completion action for lit-drop campaigns.' },
  ],
};

// Label + hint + native checkbox row (the packet DesignPanel's Toggle, with a color dot).
const Toggle = ({ id, label, hint, dot, checked, disabled, onChange }) => (
  <label
    htmlFor={id}
    className={`flex items-start justify-between gap-3 border-b border-border py-2.5 last:border-0 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
  >
    <span className="flex min-w-0 items-start gap-2.5">
      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: dot }} aria-hidden />
      <span className="min-w-0">
        <span className="block text-sm text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-fg-muted">{hint}</span>}
      </span>
    </span>
    <input
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 h-4 w-4 shrink-0 accent-brand-accent"
    />
  </label>
);

// App Customization: what the canvasser app offers at this campaign's doors. Today that is the
// door-outcome toggles (Campaign.disabledOutcomes) with a live phone preview, plus a small
// Reclassification card for the common "I turned this off, fold its history in" follow-up —
// the full entry-editing surface is the Door Outcomes page. Future field-app settings belong
// on this page too. Checked = the button is AVAILABLE, so the default state
// reads as everything-on. Turning one off hides its button and makes the server refuse fresh
// submissions (OUTCOME_DISABLED); doors already recorded keep their status and keep counting on
// every report. Leads reach this page too — the field is deliberately lead-editable, like the
// door goal.
//
// The one exception is the "Off until you turn it on" section (Campaign.enabledOutcomes — the
// opt-in class, docs/PROPOSAL_NOT_TARGET_OUTCOME.md): an outcome nobody can verify, so it starts
// off everywhere, only an org admin may switch it (the server 403s a lead), and turning it ON asks
// first. It appears only once Doorline has released it (the campaigns response's
// optInOutcomesAvailable), plus one "paused" state: withdrawn by Doorline but still set on here,
// where only the turn-off is offered.
export default function AppCustomizationPage() {
  const { campaignId } = useParams();
  const qc = useQueryClient();
  const { isOrgAdmin } = useAuth();

  const { campaign: current, campaignsQ, resolving, notFound } = useCurrentCampaign(campaignId);

  // Optimistic display while a save is in flight: show the array we just sent, then hand
  // back to server truth once the invalidate refetches (onSuccess returns the promise, so
  // onSettled doesn't clear the override until the fresh list is in the cache). On error
  // the clear snaps the checkbox — and the phone preview — back to what the server still has.
  const [pendingNext, setPendingNext] = useState(null);
  const save = useMutation({
    mutationFn: (next) => api(`/admin/campaigns/${campaignId}`, { method: 'PATCH', body: { disabledOutcomes: next } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] }),
    onSettled: () => setPendingNext(null),
  });

  // Same optimistic pattern for the off-by-default outcomes (Campaign.enabledOutcomes). Its own
  // mutation, so a failed switch can never roll back a deny-list flip or vice versa.
  const [pendingEnabled, setPendingEnabled] = useState(null);
  const [confirmOn, setConfirmOn] = useState(null); // the outcome key awaiting "Turn on"
  const saveEnabled = useMutation({
    mutationFn: (next) => api(`/admin/campaigns/${campaignId}`, { method: 'PATCH', body: { enabledOutcomes: next } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] }),
    onSettled: () => setPendingEnabled(null),
  });

  // Same optimistic pattern for the walk-up policy (Campaign.doorAddPolicy).
  const [pendingPolicy, setPendingPolicy] = useState(null);
  const savePolicy = useMutation({
    mutationFn: (policy) => api(`/admin/campaigns/${campaignId}`, { method: 'PATCH', body: { doorAddPolicy: policy } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] }),
    onSettled: () => setPendingPolicy(null),
  });

  if (resolving) return <CampaignLoading />;
  if (notFound) return <CampaignMissing />;

  const type = current.type === 'lit_drop' ? 'lit_drop' : 'survey';
  const disabled = pendingNext ?? current.disabledOutcomes ?? [];

  const setAvailable = (key, available) => {
    const next = available ? disabled.filter((k) => k !== key) : [...disabled, key];
    setPendingNext(next);
    save.mutate(next);
  };

  // The opt-in row's three states: released (the normal switch); withdrawn by Doorline while still
  // set on here (paused — turn-off only); otherwise no row at all.
  const released = campaignsQ.data?.optInOutcomesAvailable || [];
  const enabled = pendingEnabled ?? current.enabledOutcomes ?? [];
  const notTargetOn = enabled.includes('not_target');
  const notTargetState = type !== 'survey'
    ? null
    : released.includes('not_target')
      ? 'released'
      : notTargetOn
        ? 'paused'
        : null;
  const setEnabled = (key, on) => {
    const next = on ? [...enabled.filter((k) => k !== key), key] : enabled.filter((k) => k !== key);
    setPendingEnabled(next);
    saveEnabled.mutate(next);
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-fg">{current.name}</h1>
        <div className="mt-1 text-sm text-fg-muted">App Customization — what canvassers see and record at the door</div>
      </div>

      <div className="flex flex-col-reverse gap-8 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <Section title="Door outcomes">
            <p className="mb-2 text-sm text-fg-muted">
              Turning an outcome off hides its button in the field app and blocks new submissions. Doors already
              recorded keep their status and keep counting in every report — this changes what can be recorded from
              now on, nothing about the past.
            </p>
            {TOGGLE_ORDER[type].map((key) => (
              <Toggle
                key={key}
                id={`outcome-${key}`}
                label={ACTION_LABELS[key]}
                hint={OUTCOME_HINTS[key]}
                dot={STATUS_COLORS[key]}
                checked={!disabled.includes(key)}
                disabled={save.isPending}
                onChange={(available) => setAvailable(key, available)}
              />
            ))}
            {save.isError && (
              <div className="mt-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
                {save.error?.message || 'Could not save. Try again.'}
              </div>
            )}
          </Section>

          {notTargetState && (
            <Section title="Off until you turn it on">
              <p className="mb-2 text-sm text-fg-muted">
                These outcomes can't be verified, so they start off on every campaign. When one is on, everyone on
                this campaign gets the button — including anyone a team lead adds to the crew later.
                {isOrgAdmin ? ' Only org admins can change this.' : ' Only org admins can turn this on or off.'}
              </p>
              <Toggle
                id="outcome-not_target"
                label={ACTION_LABELS.not_target}
                hint={
                  notTargetState === 'paused'
                    ? 'Paused by Doorline — no phone shows this button right now. You can still turn it off for this campaign.'
                    : OUTCOME_HINTS.not_target
                }
                dot={STATUS_COLORS.not_target}
                checked={notTargetOn}
                // A lead sees the state but can't change it; while paused, only the turn-off is offered.
                disabled={!isOrgAdmin || saveEnabled.isPending || (notTargetState === 'paused' && !notTargetOn)}
                onChange={(on) => (on ? setConfirmOn('not_target') : setEnabled('not_target', false))}
              />
              {notTargetOn && (
                <p className="mt-2 text-xs text-fg-muted">
                  Turning it off needs no confirmation. Entries already recorded keep counting. A phone that is offline
                  keeps the button until it reconnects — review those entries on Door Outcomes, where they are marked
                  Offline.
                </p>
              )}
              {saveEnabled.isError && (
                <div className="mt-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
                  {saveEnabled.error?.message || 'Could not save. Try again.'}
                </div>
              )}
            </Section>
          )}

          <Section title="Always available">
            <p className="mb-2 text-sm text-fg-muted">These can't be turned off — without them a walk can't be recorded at all.</p>
            {ALWAYS_ON_ROWS[type].map((row) => (
              <div key={row.key} className="flex items-start gap-2.5 border-b border-border py-2.5 last:border-0">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: STATUS_COLORS[row.dot] }} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm text-fg">{ACTION_LABELS[row.key]}</span>
                  <span className="mt-0.5 block text-xs text-fg-muted">{row.hint}</span>
                </span>
              </div>
            ))}
          </Section>

          {/* Walk-up voters (survey campaigns only — lit-drop doors carry no voter roster).
              Who gets the "Add person" button at a door; the server backstops a stale phone
              with ADD_VOTER_RESTRICTED either way. */}
          {type === 'survey' && (
            <Section title="Adding people at the door">
              <p className="mb-2 text-sm text-fg-muted">
                Canvassers can add someone they spoke to who lives at the address but isn't on the
                voter list — name required, phone and email optional. The person is saved to that
                address and surveyed like anyone else, marked "Added at the door".
              </p>
              {[
                { value: 'all', label: 'Everyone on the campaign', hint: 'Any assigned canvasser can add a person. The default.' },
                { value: 'leads', label: 'Team leads & admins only', hint: 'Canvassers see no Add-person button; the server refuses their adds.' },
              ].map((opt) => (
                <label
                  key={opt.value}
                  htmlFor={`door-add-${opt.value}`}
                  className={`flex items-start justify-between gap-3 border-b border-border py-2.5 last:border-0 ${savePolicy.isPending ? 'opacity-50' : 'cursor-pointer'}`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-fg">{opt.label}</span>
                    <span className="mt-0.5 block text-xs text-fg-muted">{opt.hint}</span>
                  </span>
                  <input
                    id={`door-add-${opt.value}`}
                    type="radio"
                    name="doorAddPolicy"
                    checked={(pendingPolicy ?? current.doorAddPolicy ?? 'all') === opt.value}
                    disabled={savePolicy.isPending}
                    onChange={() => {
                      setPendingPolicy(opt.value);
                      savePolicy.mutate(opt.value);
                    }}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand-accent"
                  />
                </label>
              ))}
              {savePolicy.isError && (
                <div className="mt-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
                  {savePolicy.error?.message || 'Could not save. Try again.'}
                </div>
              )}
            </Section>
          )}

          {/* Shortcut for the fold that follows a toggle-off — org-admin-only, null for
              everyone else, keyed on disabledOutcomes so a flip above refreshes its eligible
              list. The full browser lives on the Door Outcomes page. */}
          <ReclassifyCard campaignId={campaignId} disabledOutcomes={current.disabledOutcomes || []} />
        </div>

        <div className="flex shrink-0 justify-center lg:sticky lg:top-4">
          {/* What phones show: an opt-in button only while it is on AND released — a paused one is
              off on every phone. */}
          <PhonePreview
            campaignType={current.type}
            disabledOutcomes={disabled}
            enabledOutcomes={notTargetState === 'released' ? enabled : []}
          />
        </div>
      </div>

      {confirmOn && (
        <Modal
          size="md"
          onClose={() => setConfirmOn(null)}
          title={`Turn on "${ACTION_LABELS[confirmOn]}" for ${current.name}?`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmOn(null)}>Cancel</Button>
              <Button
                onClick={() => {
                  setEnabled(confirmOn, true);
                  setConfirmOn(null);
                }}
              >
                Turn on
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-fg">
            Everyone canvassing this campaign sees the button once their app is up to date — including anyone a team
            lead adds to the crew later.
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
            <li>It counts as a knock and as reaching a person (Contact %), never as a survey. Connection rate is unaffected.</li>
            <li>No name is recorded, so an entry can't be verified. Turn it on only for crews you trust.</li>
            <li>Each entry is GPS-stamped and shows on that canvasser's row on Home and Timeline.</li>
            <li>This change is recorded in the campaign's History with your name.</li>
          </ul>
        </Modal>
      )}
    </div>
  );
}
