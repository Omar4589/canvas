import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { Button, Badge, Card, Modal, Segmented } from '../components/ui/index.js';
import ClientReportView from '../components/ClientReportView.jsx';
import ClientReportMap from '../components/ClientReportMap.jsx';
import NextStepBanner from '../components/NextStepBanner.jsx';
import { formatWeekRange, shiftDays } from '../lib/datePresets.js';
import { formatDateInTz } from '../lib/datetime.js';

const STATUS_VARIANT = { draft: 'neutral', published: 'success', archived: 'warning' };
const inputCls =
  'w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none';
const chipCls = 'inline-flex items-center rounded-full bg-sunken px-2 py-0.5 text-xs text-fg-muted';

// Canonical JSON of just the editable fields, so we can tell a dirty draft from the saved report.
// Key arrays are sorted (toggle order isn't a real change) and blank observation sections dropped,
// mirroring exactly what save() persists.
function editableSnapshot(src) {
  return JSON.stringify({
    title: src.title || '',
    observations: (src.observations || [])
      .filter((s) => (s.heading || '').trim())
      .map((s) => ({ heading: s.heading, body: s.body || '' })),
    supportQuestionKey: src.supportQuestionKey || null,
    visibility: {
      visibleQuestionKeys: [...(src.visibility?.visibleQuestionKeys || [])].sort(),
      mapAnswerKeys: [...(src.visibility?.mapAnswerKeys || [])].sort(),
      showMap: src.visibility?.showMap !== false,
      visibleTags: [...(src.visibility?.visibleTags || [])].sort(),
      showGoal: !!src.visibility?.showGoal,
    },
  });
}

export default function ClientReportBuilderPage() {
  const { campaignId, id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('edit');
  const [draft, setDraft] = useState(null); // local editable copy
  const [msg, setMsg] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);

  const reportQ = useQuery({
    queryKey: ['admin', 'client-report', id],
    queryFn: () => api(`/admin/client-reports/${id}`),
  });
  const report = reportQ.data?.report;

  // Seed the editable draft once per loaded report id.
  useEffect(() => {
    if (!report) return;
    setDraft({
      title: report.title || '',
      observations: report.observations || [],
      supportQuestionKey: report.supportQuestionKey || '',
      visibility: {
        visibleQuestionKeys: report.visibility?.visibleQuestionKeys || [],
        mapAnswerKeys: report.visibility?.mapAnswerKeys || [],
        showMap: report.visibility?.showMap !== false,
        visibleTags: report.visibility?.visibleTags || [],
        showGoal: !!report.visibility?.showGoal,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?._id]);

  // Prefetch the preview as soon as the report loads so switching to the Preview tab is instant.
  // (It reflects the last SAVED state — a save invalidates and refetches it.)
  const previewQ = useQuery({
    queryKey: ['admin', 'client-report-preview', id],
    queryFn: () => api(`/admin/client-reports/${id}/preview`),
    enabled: !!report,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'client-report', id] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'client-report-preview', id] });
    // Status changes (publish/unpublish/save) also refresh the campaign's reports list.
    queryClient.invalidateQueries({ queryKey: ['admin', 'client-reports', campaignId] });
  };
  const flashTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(flashTimerRef.current), []);
  const flash = (m) => {
    setMsg(m);
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setMsg(null), 2500);
  };

  const saveM = useMutation({
    mutationFn: (body) => api(`/admin/client-reports/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      invalidate();
      flash('Saved.');
    },
    onError: (e) => flash(e.message),
  });
  const recomputeM = useMutation({
    mutationFn: () => api(`/admin/client-reports/${id}/recompute`, { method: 'POST' }),
    onSuccess: () => {
      invalidate();
      flash('Stats recomputed.');
    },
  });
  const publishM = useMutation({
    mutationFn: () => api(`/admin/client-reports/${id}/publish`, { method: 'POST' }),
    onSuccess: () => {
      invalidate();
      flash('Published.');
      setTab('preview');
    },
  });
  const unpublishM = useMutation({
    mutationFn: () => api(`/admin/client-reports/${id}/unpublish`, { method: 'POST' }),
    onSuccess: () => {
      invalidate();
      flash('Moved back to draft.');
    },
  });

  if (reportQ.isLoading || !draft) return <div className="p-6 text-sm text-fg-muted">Loading…</div>;
  if (reportQ.isError) return <div className="p-6 text-sm text-danger">Report not found.</div>;

  const isDraft = report.status === 'draft';
  const questions = report.stats?.cumulative?.surveyBreakdowns || [];
  // Present only when the campaign has a door goal AND this report is campaign-wide — the
  // server writes it during recompute (routes/admin/clientReports.js snapshotGoal).
  const goalSnapshot = report.goalSnapshot?.target ? report.goalSnapshot : null;
  // Tag rows come from the SNAPSHOT (like `questions`), so the checklist offers exactly what a
  // publish would show. Defensive: a report computed before tags existed simply offers none.
  const reportTags = report.stats?.cumulative?.tagBreakdowns || [];

  // Soft publish gate: unreviewed mock-GPS flags inside this report's window (server-
  // computed on GET). The deep link seeds the Audit page with the widest range the
  // server accepts (62 days), ending at the report's week end.
  const openMockFlags = reportQ.data?.openMockFlags || 0;
  const mockAuditHref =
    `/campaigns/${report.campaignId}/audit?reason=mock_gps&status=open` +
    `&from=${shiftDays(report.weekEnd, -61)}&to=${report.weekEnd}`;

  // Unsaved-changes indicator + the "what the client sees" recap/validation.
  const dirty = isDraft && editableSnapshot(draft) !== editableSnapshot(report);
  const visibleKeys = draft.visibility.visibleQuestionKeys;
  const visibleCount = visibleKeys.length || questions.length; // empty whitelist = all shown
  const supportLabel = questions.find((q) => q.questionKey === draft.supportQuestionKey)?.questionLabel;
  // A non-empty whitelist that omits the support question hides its breakdown from the client.
  const supportHidden =
    !!draft.supportQuestionKey && visibleKeys.length > 0 && !visibleKeys.includes(draft.supportQuestionKey);

  function saveBody() {
    return {
      title: draft.title,
      observations: draft.observations.filter((s) => s.heading.trim()),
      supportQuestionKey: draft.supportQuestionKey || null,
      visibility: draft.visibility,
    };
  }
  function save() {
    saveM.mutate(saveBody());
  }
  // Persist edits BEFORE freezing — publish reads the saved report, so the save must land first.
  async function saveThenPublish() {
    try {
      await saveM.mutateAsync(saveBody());
      await publishM.mutateAsync();
    } catch {
      /* mutation onError already surfaced the message */
    }
  }

  // --- observations editing ---
  const setObs = (i, patch) =>
    setDraft((d) => ({
      ...d,
      observations: d.observations.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    }));
  const addObs = () =>
    setDraft((d) => ({ ...d, observations: [...d.observations, { heading: '', body: '' }] }));
  const removeObs = (i) =>
    setDraft((d) => ({ ...d, observations: d.observations.filter((_, j) => j !== i) }));
  const moveObs = (i, dir) =>
    setDraft((d) => {
      const next = [...d.observations];
      const j = i + dir;
      if (j < 0 || j >= next.length) return d;
      [next[i], next[j]] = [next[j], next[i]];
      return { ...d, observations: next };
    });

  async function downloadPdf() {
    const r = previewQ.data?.report;
    if (!r) return;
    setPdfBusy(true);
    try {
      const { generateReportPdf } = await import('../lib/reportPdf.js');
      await generateReportPdf(r, {
        campaignName: reportQ.data?.campaignName,
        orgName: reportQ.data?.orgName,
      });
    } catch (err) {
      console.error('PDF export failed', err);
      flash('Could not build the PDF.');
    } finally {
      setPdfBusy(false);
    }
  }

  // --- visibility toggles ---
  const toggleKey = (group, key) =>
    setDraft((d) => {
      const set = new Set(d.visibility[group]);
      set.has(key) ? set.delete(key) : set.add(key);
      return { ...d, visibility: { ...d.visibility, [group]: [...set] } };
    });

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <button onClick={() => navigate(`/campaigns/${campaignId}/reports`)} className="text-xs text-brand-accent hover:underline">
            ← All reports
          </button>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold text-fg">
              {report.title || formatWeekRange(report.weekStart, report.weekEnd)}
            </h1>
            <Badge variant={STATUS_VARIANT[report.status]} dot>
              {report.status}
            </Badge>
          </div>
          <div className="text-xs text-fg-muted">
            {formatWeekRange(report.weekStart, report.weekEnd)} · {report.timeZone}
            {report.effortName ? ` · Walk list: ${report.effortName}` : ''}
          </div>
          {report.status === 'published' && (
            <div className="mt-0.5 text-xs text-fg-subtle">
              {(report.viewCount ?? 0) > 0
                ? `Viewed ${report.viewCount.toLocaleString()}× by the client · last ${formatDateInTz(report.lastViewedAt, report.timeZone)}`
                : 'Not viewed by the client yet'}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {msg ? (
            <span className="text-xs text-fg-muted">{msg}</span>
          ) : (
            isDraft && (
              <span className={`text-xs ${dirty ? 'text-warning-fg' : 'text-fg-subtle'}`}>
                {dirty ? 'Unsaved changes' : 'All changes saved'}
              </span>
            )
          )}
          {isDraft ? (
            <>
              <Button variant="secondary" onClick={() => recomputeM.mutate()} loading={recomputeM.isPending}>
                Recompute
              </Button>
              <Button variant="secondary" onClick={save} loading={saveM.isPending}>
                Save
              </Button>
              <Button onClick={() => setConfirmPublish(true)} loading={publishM.isPending || saveM.isPending}>
                Publish
              </Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => unpublishM.mutate()} loading={unpublishM.isPending}>
              Unpublish to edit
            </Button>
          )}
        </div>
      </div>

      {openMockFlags > 0 && (
        <NextStepBanner
          tone="danger"
          title="Mock GPS in this report's window."
          action={{ label: 'Review mock flags', to: mockAuditHref }}
        >
          {openMockFlags.toLocaleString()} unreviewed mock-location flag{openMockFlags === 1 ? '' : 's'} fall
          {openMockFlags === 1 ? 's' : ''} inside this report's numbers. You can still publish — flags can be
          false alarms — but review them first.
        </NextStepBanner>
      )}

      <Segmented
        options={[
          { value: 'edit', label: 'Edit' },
          { value: 'preview', label: 'Preview' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'edit' && (
        <div className="space-y-5">
          {!isDraft && (
            <Card className="bg-warning-tint p-3 text-sm text-warning-fg">
              This report is published. Unpublish it to make changes.
            </Card>
          )}

          <Card className="p-4">
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              Report title
              <input
                className={inputCls}
                value={draft.title}
                disabled={!isDraft}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder={formatWeekRange(report.weekStart, report.weekEnd)}
              />
            </label>
          </Card>

          {/* Observations editor */}
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-fg">Canvasser observations</div>
              {isDraft && (
                <Button size="sm" variant="secondary" onClick={addObs}>
                  + Add section
                </Button>
              )}
            </div>
            {draft.observations.length === 0 && (
              <div className="text-sm text-fg-muted">No sections yet. Add one to write your observations.</div>
            )}
            <div className="space-y-4">
              {draft.observations.map((s, i) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <input
                      className={inputCls}
                      value={s.heading}
                      disabled={!isDraft}
                      placeholder="Section heading (e.g. Voter Intent)"
                      onChange={(e) => setObs(i, { heading: e.target.value })}
                    />
                    {isDraft && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button onClick={() => moveObs(i, -1)} className="px-1 text-fg-muted hover:text-fg" title="Move up">↑</button>
                        <button onClick={() => moveObs(i, 1)} className="px-1 text-fg-muted hover:text-fg" title="Move down">↓</button>
                        <button onClick={() => removeObs(i)} className="px-1 text-danger hover:opacity-80" title="Remove">✕</button>
                      </div>
                    )}
                  </div>
                  <textarea
                    className={inputCls + ' mt-2 min-h-[90px]'}
                    value={s.body}
                    disabled={!isDraft}
                    placeholder="Write the observation paragraph…"
                    onChange={(e) => setObs(i, { body: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </Card>

          {/* Support question + visibility */}
          <Card className="p-4">
            <div className="text-sm font-semibold text-fg">What the client sees</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className={chipCls}>Scope: {report.effortName || 'Whole campaign'}</span>
              <span className={chipCls}>Support: {supportLabel || 'None'}</span>
              <span className={chipCls}>
                {visibleCount} of {questions.length} question{questions.length === 1 ? '' : 's'} shown
              </span>
              {reportTags.length > 0 && (
                <span className={chipCls}>
                  Tags:{' '}
                  {draft.visibility.visibleTags.length
                    ? `${draft.visibility.visibleTags.length} shown`
                    : 'none'}
                </span>
              )}
              <span className={chipCls}>Map: {draft.visibility.showMap ? 'On' : 'Off'}</span>
            </div>
            {supportHidden && (
              <Card className="mt-3 bg-warning-tint p-2.5 text-xs text-warning-fg">
                The headline support question isn't in the visible list, so the client won't see its
                breakdown. Check it under “Visible survey questions” below.
              </Card>
            )}
            <div className="mt-3 grid gap-5 md:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Headline “support” question
                </div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="support"
                      checked={!draft.supportQuestionKey}
                      disabled={!isDraft}
                      onChange={() => setDraft((d) => ({ ...d, supportQuestionKey: '' }))}
                    />
                    <span className="text-fg-muted">None</span>
                  </label>
                  {questions.map((q) => (
                    <label key={q.questionKey} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="support"
                        checked={draft.supportQuestionKey === q.questionKey}
                        disabled={!isDraft}
                        onChange={() => setDraft((d) => ({ ...d, supportQuestionKey: q.questionKey }))}
                      />
                      <span className="text-fg">{q.questionLabel}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Visible survey questions
                </div>
                <div className="space-y-1.5">
                  {questions.map((q) => (
                    <label key={q.questionKey} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.visibility.visibleQuestionKeys.includes(q.questionKey)}
                        disabled={!isDraft}
                        onChange={() => toggleKey('visibleQuestionKeys', q.questionKey)}
                      />
                      <span className="text-fg">{q.questionLabel}</span>
                    </label>
                  ))}
                  {questions.length === 0 && <div className="text-sm text-fg-muted">No survey questions.</div>}
                </div>
              </div>
            </div>

            {/* Tags are OPT-IN — the opposite default of the question checklist above. Tag
                names are internal labels ("Hostile", "Do not return") that would land on an
                unauthenticated page, so nothing shows without an explicit tick. */}
            <div className="mt-5 border-t border-border pt-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
                Visible tags
              </div>
              <p className="mb-2 text-xs text-fg-muted">
                Tags are hidden until you tick them — an unticked tag never appears on the report.
                A shown tag reports two counts: voters identified, and how many still gave a tagged
                answer at last contact.
              </p>
              {reportTags.length === 0 ? (
                <div className="text-sm text-fg-muted">
                  No tagged answers in this report's numbers. Recompute after tagging survey options
                  to pick them up.
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {reportTags.map((t) => (
                    <label key={t.tag} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.visibility.visibleTags.includes(t.tag)}
                        disabled={!isDraft}
                        onChange={() => toggleKey('visibleTags', t.tag)}
                      />
                      <span className="text-fg">{t.tag}</span>
                      <span className="text-xs text-fg-muted">
                        · {(t.identifiedVoters || 0).toLocaleString()} identified
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Door goal — opt-in, and only offered when there's actually a frozen snapshot to
                show (no goal on the campaign, or a walk-list-scoped report, means there isn't
                one; the server rejects ticking it in those cases rather than silently showing
                the client nothing). */}
            <div className="mt-5 border-t border-border pt-4">
              <label className={`flex items-center gap-2 text-sm ${goalSnapshot ? '' : 'opacity-60'}`}>
                <input
                  type="checkbox"
                  checked={!!draft.visibility.showGoal}
                  disabled={!isDraft || !goalSnapshot}
                  onChange={(e) => setDraft((d) => ({ ...d, visibility: { ...d.visibility, showGoal: e.target.checked } }))}
                />
                <span className="text-fg">Show door-goal progress to the client</span>
              </label>
              <p className="mt-1 text-xs text-fg-muted">
                {goalSnapshot
                  ? `${goalSnapshot.done?.toLocaleString() ?? 0} of ${goalSnapshot.target?.toLocaleString()} doors as of this report's week — progress only, never a pace or an "on track" verdict. Off by default: anyone with the share link can read it.`
                  : report?.effortId
                    ? 'Door goals are campaign-wide, so they can’t be shown on a walk-list-scoped report.'
                    : 'This campaign has no door goal set. Add one from the Campaigns page, then recompute.'}
              </p>
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.visibility.showMap}
                  disabled={!isDraft}
                  onChange={(e) => setDraft((d) => ({ ...d, visibility: { ...d.visibility, showMap: e.target.checked } }))}
                />
                <span className="text-fg">Show the coverage map to the client</span>
              </label>
              {draft.visibility.showMap && questions.length > 0 && (
                <div className="mt-3">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
                    Survey answers available as map filters
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {questions.map((q) => (
                      <label key={q.questionKey} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={draft.visibility.mapAnswerKeys.includes(q.questionKey)}
                          disabled={!isDraft}
                          onChange={() => toggleKey('mapAnswerKeys', q.questionKey)}
                        />
                        <span className="text-fg">{q.questionLabel}</span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 rounded bg-info-tint p-2 text-xs text-info-fg">
                    Map answer filters apply on the next publish — they're frozen into the snapshot.
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {tab === 'preview' && (
        <div className="space-y-6">
          {previewQ.isLoading && <div className="text-sm text-fg-muted">Building preview…</div>}
          {previewQ.data?.report && (
            <>
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" loading={pdfBusy} onClick={downloadPdf}>
                  ⤓ Download PDF
                </Button>
              </div>
              {/* INTERNAL, and only when there is something to disclose. The client never sees this
                  — a desk-entered answer is a real answer and counts identically, so annotating the
                  published figures would misrepresent them the other way. But the person about to
                  send this report should not learn afterwards that some of it was typed at a desk. */}
              {previewQ.data.provenance?.cumulative?.deskEnteredResponses > 0 && (
                <div className="rounded-card border border-warning/40 bg-warning-tint px-3 py-2 text-sm text-warning-fg">
                  <span className="font-medium">Internal note — not shown to the client.</span>{' '}
                  {previewQ.data.provenance.cumulative.deskEnteredResponses.toLocaleString()} of{' '}
                  {previewQ.data.provenance.cumulative.totalResponses.toLocaleString()} survey
                  responses behind these figures were entered by an admin on Door Outcomes rather
                  than collected at a door
                  {previewQ.data.provenance.period?.deskEnteredResponses > 0 &&
                    ` (${previewQ.data.provenance.period.deskEnteredResponses.toLocaleString()} of them in this report's own week)`}
                  . They count the same as any other answer — this is here so you know before you
                  send it.
                </div>
              )}
              <ClientReportView report={previewQ.data.report} />
              {previewQ.data.report.visibility?.showMap && (
                <section>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
                    Coverage map {report.status === 'draft' && '(live preview)'}
                  </h2>
                  <ClientReportMap
                    mapDataPath={`/admin/client-reports/${id}/preview/map`}
                    tokenPath="/admin/config/mapbox-token"
                    survey={previewQ.data.survey}
                    campaignType={previewQ.data.report.campaignType}
                  />
                </section>
              )}
            </>
          )}
        </div>
      )}

      {confirmPublish && (
        <Modal
          size="lg"
          onClose={() => setConfirmPublish(false)}
          title="Publish this report?"
          subtitle="Publishing freezes the report — what the client sees from here on."
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmPublish(false)}>
                Cancel
              </Button>
              <Button
                loading={publishM.isPending || saveM.isPending}
                onClick={async () => {
                  await saveThenPublish();
                  setConfirmPublish(false);
                }}
              >
                Publish
              </Button>
            </>
          }
        >
          {openMockFlags > 0 && (
            <div className="mb-3 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-fg">
              {openMockFlags.toLocaleString()} unreviewed mock-location flag{openMockFlags === 1 ? ' is' : 's are'} in
              this report's window — those entries are included in the numbers you're about to freeze.
            </div>
          )}
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
            <li>The cumulative and weekly numbers are frozen exactly as they are now.</li>
            <li>The coverage map is snapshotted (door statuses as of the week's end).</li>
            <li>The report becomes visible to anyone with a share link for this campaign.</li>
            <li>You can “Unpublish to edit” later, then republish to refresh the snapshot.</li>
          </ul>
        </Modal>
      )}
    </div>
  );
}
