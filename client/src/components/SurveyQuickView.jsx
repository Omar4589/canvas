import { Link, useNavigate } from 'react-router-dom';
import { Drawer, Badge, Button } from './ui';
import SurveyPreview from './SurveyPreview.jsx';

// Read-only quick view of one survey template in a right-side drawer — the fast
// "what is this survey, where does it run, how is it doing" pane. Authoring lives
// on /surveys/:id/edit; results deep-link to the campaign dashboard (?survey=).
// Props: survey = one row from GET /admin/surveys (template + usedByCampaigns +
// usedByWalkLists + responseCount + responseCountByCampaign).

const SECTION_LABEL = 'text-xs font-semibold uppercase tracking-wide text-fg-muted';

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

export default function SurveyQuickView({
  survey,
  onClose,
  onDuplicate,
  onArchive,
  onUnarchive,
  onDelete,
  busy = false,
  deleteError = null,
}) {
  const navigate = useNavigate();
  if (!survey) return null;

  const usedByCampaigns = survey.usedByCampaigns || [];
  const usedByWalkLists = survey.usedByWalkLists || [];
  const byCampaign = survey.responseCountByCampaign || [];
  const archived = !!survey.archivedAt;
  const inUse = usedByCampaigns.length > 0 || usedByWalkLists.length > 0;
  const deletable = survey.responseCount === 0 && !inUse;

  // Campaigns worth a results link: current default attachments ∪ campaigns that
  // actually collected responses under this survey (covers swapped-away history).
  const resultCampaigns = new Map();
  for (const c of usedByCampaigns) resultCampaigns.set(String(c.id), c.name);
  for (const r of byCampaign) {
    if (r.count > 0 && r.campaignId) resultCampaigns.set(String(r.campaignId), r.campaignName);
  }
  const resultLinks = [...resultCampaigns.entries()];
  const resultsHref = (cId) => `/campaigns/${cId}?survey=${survey._id}`;

  return (
    <Drawer onClose={onClose} title={survey.name} width="max-w-lg">
      {/* Drawer's children container scrolls; the action bar stays pinned via sticky. */}
      <div>
        <div>
          {/* Status + metadata */}
          <div className="border-b border-border px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="neutral">v{survey.version || 1}</Badge>
              {archived ? (
                <Badge variant="neutral" dot>Archived</Badge>
              ) : inUse ? (
                <Badge variant="success" dot>In use</Badge>
              ) : (
                <Badge variant="neutral" dot>Draft</Badge>
              )}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-fg-muted">Created</dt>
              <dd className="text-right tabular-nums text-fg">{fmtDate(survey.createdAt)}</dd>
              <dt className="text-fg-muted">Last updated</dt>
              <dd className="text-right tabular-nums text-fg">{fmtDate(survey.updatedAt)}</dd>
              <dt className="text-fg-muted">Questions</dt>
              <dd className="text-right tabular-nums text-fg">
                {(survey.questions || []).filter((q) => !q.retired).length}
              </dd>
            </dl>
          </div>

          {/* Used in */}
          <div className="border-b border-border px-5 py-4">
            <div className={SECTION_LABEL}>Used in</div>
            {!inUse ? (
              <p className="mt-2 text-sm text-fg-muted">Not used by any campaign or walk list yet.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm">
                {usedByCampaigns.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <Link to={resultsHref(c.id)} className="truncate font-medium text-brand-accent hover:underline">
                      {c.name}
                    </Link>
                    <span className="shrink-0 text-xs text-fg-subtle">
                      campaign default{c.isActive ? '' : ' · inactive'}
                    </span>
                  </li>
                ))}
                {usedByWalkLists.map((w) => (
                  <li key={w.effortId} className="flex items-center justify-between gap-2">
                    <Link to={resultsHref(w.campaignId)} className="truncate text-brand-accent hover:underline">
                      {w.campaignName} <span className="text-fg-muted">· {w.effortName}</span>
                    </Link>
                    <span className="shrink-0 text-xs text-fg-subtle">walk list</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Responses */}
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-baseline justify-between">
              <div className={SECTION_LABEL}>Responses</div>
              <div className="text-lg font-semibold tabular-nums text-fg">
                {survey.responseCount > 0 ? survey.responseCount.toLocaleString() : '—'}
              </div>
            </div>
            {byCampaign.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {byCampaign.map((r) => (
                  <li key={r.campaignId || 'none'} className="flex items-center justify-between gap-2">
                    <span className="truncate text-fg-muted">{r.campaignName}</span>
                    <span className="shrink-0 tabular-nums text-fg">{r.count.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
            {resultLinks.length === 1 && (
              <Link
                to={resultsHref(resultLinks[0][0])}
                className="mt-3 inline-block text-sm font-medium text-brand-accent hover:underline"
              >
                View full results →
              </Link>
            )}
            {resultLinks.length > 1 && (
              <div className="mt-3 space-y-1">
                {resultLinks.map(([cId, cName]) => (
                  <Link
                    key={cId}
                    to={resultsHref(cId)}
                    className="block text-sm font-medium text-brand-accent hover:underline"
                  >
                    Results in {cName} →
                  </Link>
                ))}
              </div>
            )}
            {survey.responseCount > 0 && (
              <p className="mt-3 rounded bg-sunken px-3 py-2 text-xs text-fg-muted">
                This survey has responses, so questions can be reworded, reordered, added, or retired —
                but an answer <strong className="font-medium text-fg">type</strong> can’t change.
                Duplicate it for structural changes.
              </p>
            )}
          </div>

          {/* Questions */}
          <div className="px-5 py-4">
            <div className={`${SECTION_LABEL} mb-2`}>Questions</div>
            <SurveyPreview survey={survey} />
          </div>
        </div>

        {/* Action bar */}
        <div className="sticky bottom-0 border-t border-border bg-card px-5 py-3">
          {deleteError && (
            <div className="mb-2 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-xs text-danger">
              <p>{deleteError.message}</p>
              {deleteError.data?.reasons?.length > 0 && (
                <ul className="mt-1 list-inside list-disc">
                  {deleteError.data.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => navigate(`/surveys/${survey._id}/edit`)}>
              Edit survey
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onDuplicate(survey._id)} disabled={busy}>
              Duplicate
            </Button>
            <div className="ml-auto">
              {deletable ? (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete survey "${survey.name}"? This can’t be undone.`)) {
                      onDelete(survey._id);
                    }
                  }}
                >
                  Delete
                </Button>
              ) : archived ? (
                <Button size="sm" variant="secondary" onClick={() => onUnarchive(survey._id)} disabled={busy}>
                  Unarchive
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onArchive(survey._id)}
                  title="Hide from the active list and pickers — responses and reports keep working"
                >
                  Archive
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
