import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { Button, Badge, Card } from '../components/ui/index.js';
import ClientReportView from '../components/ClientReportView.jsx';
import ClientReportMap from '../components/ClientReportMap.jsx';

const STATUS_VARIANT = { draft: 'neutral', published: 'success', archived: 'warning' };
const inputCls =
  'w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none';

export default function ClientReportBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('edit');
  const [draft, setDraft] = useState(null); // local editable copy
  const [msg, setMsg] = useState(null);

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
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?._id]);

  const previewQ = useQuery({
    queryKey: ['admin', 'client-report-preview', id],
    queryFn: () => api(`/admin/client-reports/${id}/preview`),
    enabled: tab === 'preview',
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'client-report', id] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'client-report-preview', id] });
  };
  const flash = (m) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2500);
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
          <button onClick={() => navigate('/admin/client-reports')} className="text-xs text-brand-accent hover:underline">
            ← All reports
          </button>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold text-fg">
              {report.title || `${report.weekStart} → ${report.weekEnd}`}
            </h1>
            <Badge variant={STATUS_VARIANT[report.status]} dot>
              {report.status}
            </Badge>
          </div>
          <div className="text-xs text-fg-muted">
            {report.weekStart} → {report.weekEnd} · {report.timeZone}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {msg && <span className="text-xs text-fg-muted">{msg}</span>}
          {isDraft ? (
            <>
              <Button variant="secondary" onClick={() => recomputeM.mutate()} loading={recomputeM.isPending}>
                Recompute
              </Button>
              <Button variant="secondary" onClick={save} loading={saveM.isPending}>
                Save
              </Button>
              <Button onClick={saveThenPublish} loading={publishM.isPending || saveM.isPending}>
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

      <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-sm">
        {['edit', 'preview'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={'rounded px-3 py-1 capitalize ' + (tab === t ? 'bg-brand-600 text-white' : 'text-fg-muted hover:bg-sunken')}
          >
            {t}
          </button>
        ))}
      </div>

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
                placeholder={`${report.weekStart} → ${report.weekEnd}`}
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
                  <div className="mt-1 text-xs text-fg-muted">
                    Map answer filters apply on the next publish (they're frozen into the snapshot).
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
    </div>
  );
}
