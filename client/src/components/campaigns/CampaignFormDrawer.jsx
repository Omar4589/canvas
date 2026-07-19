import { useState } from 'react';
import { US_STATES } from '../../lib/validators.js';
import { Drawer, Input, Select, Textarea, Button } from '../ui/index.js';

const US_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Mountain — no DST (Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
];

export default function CampaignFormDrawer({
  initial,
  surveys,
  onSave,
  onCancel,
  saving,
  error,
  orgBillRestrictedDoors = false,
}) {
  const isEdit = !!initial?._id;
  // Once canvassing has started, the type flip is locked (server-enforced) and a
  // timezone change re-buckets historical stats — surfaced as a warning.
  const hasCanvassed = isEdit && initial?.hasCanvassed === true;
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState(initial?.type || 'survey');
  const [state, setState] = useState(initial?.state || '');
  // Anchor for the archived-picker exception: the survey attached when the drawer
  // opened stays listed even if archived (and even after being deselected mid-edit).
  const initialSurveyId = initial?.surveyTemplateId?._id || initial?.surveyTemplateId || '';
  const [surveyTemplateId, setSurveyTemplateId] = useState(initialSurveyId);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [timeZone, setTimeZone] = useState(initial?.timeZone || '');
  const [electionDay, setElectionDay] = useState(initial?.electionDay || '');
  const [earlyVotingStart, setEarlyVotingStart] = useState(initial?.earlyVotingStart || '');
  const [earlyVotingEnd, setEarlyVotingEnd] = useState(initial?.earlyVotingEnd || '');
  const [datesNote, setDatesNote] = useState(initial?.datesNote || '');
  // Tri-state, carried through the form as a STRING because a <select> has no null:
  // 'inherit' | 'yes' | 'no' ⇄ null | true | false on the wire.
  const [billRestricted, setBillRestricted] = useState(
    initial?.billRestrictedDoors === true ? 'yes' : initial?.billRestrictedDoors === false ? 'no' : 'inherit'
  );

  function submit(e) {
    e.preventDefault();
    onSave({
      name: name.trim(),
      type,
      state: state.trim().toUpperCase(),
      surveyTemplateId: type === 'survey' ? (surveyTemplateId || null) : null,
      isActive,
      timeZone: timeZone || undefined, // empty → server defaults from state
      electionDay: electionDay || null, // date fields: '' ⇄ null — send null, never ''
      earlyVotingStart: earlyVotingStart || null,
      earlyVotingEnd: earlyVotingEnd || null,
      datesNote: datesNote.trim(),
      billRestrictedDoors: billRestricted === 'yes' ? true : billRestricted === 'no' ? false : null,
    });
  }

  return (
    <Drawer title={isEdit ? 'Edit campaign' : 'New campaign'} onClose={onCancel}>
      <form onSubmit={submit} className="space-y-5 p-5">
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted">
            Campaign name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            placeholder="Kentucky 2026"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Type</label>
            <div className="flex gap-2">
              {[
                { value: 'survey', label: 'Survey' },
                { value: 'lit_drop', label: 'Lit drop' },
              ].map((t) => (
                <label
                  key={t.value}
                  className={`flex flex-1 items-center justify-center rounded border px-3 py-2 text-sm ${
                    type === t.value
                      ? 'border-brand-600 bg-brand-tint text-brand-accent'
                      : 'border-border-strong text-fg-muted hover:bg-sunken'
                  } ${hasCanvassed ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                  <input
                    type="radio"
                    name="type"
                    value={t.value}
                    checked={type === t.value}
                    onChange={() => setType(t.value)}
                    disabled={hasCanvassed}
                    className="sr-only"
                  />
                  {t.label}
                </label>
              ))}
            </div>
            {hasCanvassed && (
              <p className="mt-1 text-xs text-warning-fg">
                Type is locked once canvassing has started — create a new campaign to change it.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">
              State
            </label>
            <Select
              value={state}
              onChange={(e) => setState(e.target.value)}
              required
              className="w-full"
            >
              <option value="">Select a state…</option>
              {US_STATES.map((s) => (
                <option key={s.value} value={s.value}>{s.value} — {s.label}</option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted">Timezone</label>
          <Select
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            className="w-full"
          >
            <option value="">Auto (from state)</option>
            {US_TIMEZONES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-fg-muted">
            Anchors every date &amp; time for this campaign — all admins see the same numbers and clock times,
            regardless of their own timezone.
          </p>
          {hasCanvassed && (
            <p className="mt-1 text-xs text-warning-fg">
              Changing the timezone re-buckets all past daily stats for this campaign.
            </p>
          )}
        </div>

        {type === 'survey' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">
              Survey template <span className="font-normal text-fg-subtle">(optional)</span>
            </label>
            <Select
              value={surveyTemplateId}
              onChange={(e) => setSurveyTemplateId(e.target.value)}
              className="w-full"
            >
              <option value="">— None yet (add later on the Surveys page) —</option>
              {/* Archived surveys stay pickable only when already attached. */}
              {(surveys || [])
                .filter(
                  (s) =>
                    !s.archivedAt ||
                    String(s._id) === String(initialSurveyId) ||
                    String(s._id) === String(surveyTemplateId)
                )
                .map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name} (v{s.version || 1}{s.archivedAt ? ' · archived' : ''})
                  </option>
                ))}
            </Select>
            <p className="mt-1 text-xs text-fg-muted">
              Optional now — attach a survey here or later. You just can&apos;t activate a pass on a
              survey campaign without one.
            </p>
            {(() => {
              const chosen = (surveys || []).find((s) => s._id === surveyTemplateId);
              return chosen?.responseCount > 0 ? (
                <p className="mt-1 text-xs text-warning-fg">
                  Heads up: this survey already has {chosen.responseCount.toLocaleString()} response
                  {chosen.responseCount === 1 ? '' : 's'}. New answers will report under it alongside the
                  existing ones. To run different questions, duplicate it on the Surveys page and pick the copy.
                </p>
              ) : null;
            })()}
          </div>
        )}

        <div className="space-y-4 border-t border-border pt-4">
          <div>
            <div className="text-sm font-semibold text-fg">Key dates</div>
            <p className="mt-0.5 text-xs text-fg-muted">
              Optional — surfaced on campaign cards and dashboards.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Election Day</label>
            <Input
              type="date"
              value={electionDay}
              onChange={(e) => setElectionDay(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">Early voting start</label>
              <Input
                type="date"
                value={earlyVotingStart}
                onChange={(e) => setEarlyVotingStart(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">Early voting end</label>
              <Input
                type="date"
                value={earlyVotingEnd}
                onChange={(e) => setEarlyVotingEnd(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Key dates note</label>
            <Textarea
              value={datesNote}
              onChange={(e) => setDatesNote(e.target.value)}
              maxLength={280}
              rows={2}
              placeholder="e.g. Polls open 7am–7pm; early voting at the county clerk's office"
            />
            <p className="mt-1 text-xs text-fg-muted">
              Admins, leads, and canvassers will see this alongside the campaign&apos;s key dates.
            </p>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active (visible to canvassers)
        </label>

        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted">
            Restricted doors on invoices
          </label>
          <Select value={billRestricted} onChange={(e) => setBillRestricted(e.target.value)}>
            <option value="inherit">
              Use organization default ({orgBillRestrictedDoors ? 'count them' : "don't count them"})
            </option>
            <option value="yes">Count them as billable doors</option>
            <option value="no">Don&apos;t count them</option>
          </Select>
          <p className="mt-1 text-xs text-fg-muted">
            A restricted home is one a canvasser walked to and couldn&apos;t reach — a locked gate or
            a secured building. Counting them adds them to the door totals on your invoice export,
            since the trip still took time. It never changes your contact or survey rates, and it
            never changes what Doorline charges you.
          </p>
        </div>

        {/* Reassurance on create only — no dollars, non-blocking. */}
        {!isEdit && (
          <p className="rounded-md border border-info/30 bg-info-tint px-3 py-2 text-xs text-info-fg">
            Setup is free — a campaign only starts billing the month it&apos;s first canvassed.
          </p>
        )}

        {error && (
          <div className="rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
            {error.message}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create campaign'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
