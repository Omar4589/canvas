import { Button, Card, Input, Segmented, Select, IconInfo, IconSearch, IconX } from '../ui/index.js';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'needs-link', label: 'Needs linking' },
  { value: 'linked', label: 'Linked' },
];

const SORT_OPTIONS = [
  { value: 'status:asc', label: 'Needs attention' },
  { value: 'person:asc', label: 'Name A–Z' },
  { value: 'person:desc', label: 'Name Z–A' },
  { value: 'campaign:asc', label: 'Campaign' },
  { value: 'location:desc', label: 'Most recent shift' },
];

export default function RosterToolbar({
  filters,
  onChange,
  campaigns,
  counts,
  sort,
  onSortChange,
  suggestionCount,
  onReviewSuggestions,
  onDismissSuggestions,
  projectsDegraded,
  onRetryProjects,
}) {
  // Each clause only when it is non-zero — a count line that always renders
  // "· 0 inactive hidden" teaches people to stop reading it.
  const clauses = [`${counts.shown} of ${counts.total} shown`];
  if (counts.inactiveHidden > 0) clauses.push(`${counts.inactiveHidden} inactive hidden`);

  return (
    <>
      {suggestionCount > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-card border border-info/30 bg-info-tint px-4 py-2.5 text-sm text-info-fg">
          <IconInfo size={16} className="shrink-0" />
          <span className="flex-1">
            <strong className="font-semibold">
              {suggestionCount} {suggestionCount === 1 ? 'person' : 'people'}
            </strong>{' '}
            match by email and aren’t linked yet.
          </span>
          <Button size="sm" onClick={onReviewSuggestions}>
            Review {suggestionCount} {suggestionCount === 1 ? 'match' : 'matches'}
          </Button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismissSuggestions}
            className="rounded p-1 text-info-fg/70 hover:bg-info/10 hover:text-info-fg"
          >
            <IconX size={16} />
          </button>
        </div>
      )}

      <Card className="mb-4 p-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="min-w-[240px] flex-1">
            <Input
              type="search"
              value={filters.term}
              onChange={(e) => onChange({ term: e.target.value })}
              placeholder="Search name or email — either system…"
              leadingIcon={<IconSearch size={16} />}
            />
          </div>
          <Select
            value={filters.campaignId}
            aria-label="Filter by campaign"
            onChange={(e) => onChange({ campaignId: e.target.value })}
          >
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
                {c.isActive === false ? ' (archived)' : ''}
              </option>
            ))}
          </Select>
          <Select
            value={`${sort.key}:${sort.dir}`}
            aria-label="Sort people"
            onChange={(e) => {
              const [key, dir] = e.target.value.split(':');
              onSortChange({ key, dir });
            }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <label
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border-strong px-2.5 py-2 text-sm text-fg-muted hover:bg-sunken"
            title="Includes people switched off in either system."
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-border-strong text-brand-accent focus-visible:ring-ring"
              checked={filters.includeInactive}
              onChange={(e) => onChange({ includeInactive: e.target.checked })}
            />
            Include inactive
          </label>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
          <Segmented
            size="sm"
            options={STATUS_OPTIONS}
            value={filters.status}
            onChange={(v) => onChange({ status: v })}
          />
          {counts.problems > 0 && (
            <button
              type="button"
              aria-pressed={filters.status === 'problems'}
              onClick={() =>
                onChange({ status: filters.status === 'problems' ? 'all' : 'problems' })
              }
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                filters.status === 'problems'
                  ? 'border-warning/30 bg-warning-tint text-warning-fg'
                  : 'border-border text-fg-muted hover:bg-sunken hover:text-fg'
              }`}
            >
              Needs attention
              <span className="tabular-nums opacity-70">{counts.problems}</span>
            </button>
          )}
          <span className="ml-auto text-xs tabular-nums text-fg-muted">{clauses.join(' · ')}</span>
        </div>

        {projectsDegraded && (
          <p className="mt-2 border-t border-border pt-2 text-xs text-fg-muted">
            Couldn’t load recent FbTime projects — the mapping below still works.{' '}
            <button
              type="button"
              onClick={onRetryProjects}
              className="underline underline-offset-2 hover:text-fg"
            >
              Retry
            </button>
          </p>
        )}
      </Card>
    </>
  );
}
