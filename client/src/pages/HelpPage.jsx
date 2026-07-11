import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import HelpBlocks from '../components/help/HelpBlocks.jsx';
import {
  Card,
  Input,
  Segmented,
  EmptyState,
  Skeleton,
  IconSearch,
  IconChevronRight,
  IconChevronDown,
  IconCheck,
  IconHelp,
} from '../components/ui/index.js';

// The Help Center. Two reads: GET /help/index (metadata for guided lessons, guides, and
// page guides — no bodies) and GET /help/faq (short answers WITH blocks so they expand
// inline). The server already filters both to the caller's role, so we render what we get.
// Search + an audience Segmented filter client-side; the "Get started" path tracks
// completion in localStorage ('helpDone'), mirroring the sidebarCollapsed/campaignsView
// precedent.

const HELP_DONE_KEY = 'helpDone';

// Section order + labels, keyed by article.kind. FAQ is last (its rows expand inline).
const SECTIONS = [
  { kind: 'getting-started', label: 'Get started' },
  { kind: 'guide', label: 'Guides' },
  { kind: 'page', label: 'Page guides' },
  { kind: 'faq', label: 'FAQ' },
];

// The audience segments we surface, in role order. Only those present in the data render.
const AUDIENCE_SEGMENTS = [
  { value: 'canvasser', label: 'For canvassers' },
  { value: 'lead', label: 'For leads' },
  { value: 'admin', label: 'For admins' },
];

function readDone() {
  try {
    const raw = localStorage.getItem(HELP_DONE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999);

function SectionHeading({ children }) {
  return <h2 className="mb-3 text-lg font-semibold text-fg">{children}</h2>;
}

function ArticleRow({ item }) {
  return (
    <Link
      to={`/help/${item.slug}`}
      className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-card transition-colors hover:border-brand-accent/40 hover:bg-sunken"
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-fg group-hover:text-brand-accent">{item.title}</div>
        {item.summary && <div className="mt-0.5 truncate text-xs text-fg-muted">{item.summary}</div>}
      </div>
      <IconChevronRight size={18} className="shrink-0 text-fg-subtle transition-colors group-hover:text-brand-accent" />
    </Link>
  );
}

function LessonRow({ item, index, isDone, onToggle }) {
  return (
    <Card className="flex items-center gap-3 p-3">
      <button
        type="button"
        onClick={() => onToggle(item.slug)}
        aria-pressed={isDone}
        aria-label={isDone ? 'Mark lesson as not done' : 'Mark lesson as done'}
        title={isDone ? 'Mark as not done' : 'Mark as done'}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
          isDone
            ? 'border-success bg-success text-white'
            : 'border-border-strong text-fg-muted hover:border-brand-accent hover:text-brand-accent'
        }`}
      >
        {isDone ? <IconCheck size={16} /> : index}
      </button>
      <Link to={`/help/${item.slug}`} className="group flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <div
            className={`text-sm font-semibold group-hover:text-brand-accent ${
              isDone ? 'text-fg-muted line-through decoration-fg-subtle' : 'text-fg'
            }`}
          >
            {item.title}
          </div>
          {item.summary && <div className="mt-0.5 text-xs text-fg-muted">{item.summary}</div>}
        </div>
        <IconChevronRight size={18} className="shrink-0 text-fg-subtle transition-colors group-hover:text-brand-accent" />
      </Link>
    </Card>
  );
}

function FaqRow({ item, open, onToggle }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-sunken"
      >
        <span className="min-w-0 flex-1 text-sm font-medium text-fg">{item.question || item.title}</span>
        <IconChevronDown
          size={18}
          className={`shrink-0 text-fg-subtle transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3">
          <HelpBlocks blocks={item.blocks || []} />
        </div>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-full max-w-sm" />
      {[0, 1].map((s) => (
        <div key={s} className="space-y-3">
          <Skeleton className="h-5 w-32" />
          {[0, 1, 2].map((r) => (
            <Skeleton key={r} className="h-16 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function HelpPage() {
  const [search, setSearch] = useState('');
  const [audience, setAudience] = useState('all');
  const [done, setDone] = useState(readDone);
  const [openFaq, setOpenFaq] = useState(() => new Set());

  useEffect(() => {
    document.title = 'Help Center';
  }, []);

  const indexQ = useQuery({
    queryKey: ['help', 'index'],
    queryFn: () => api('/help/index'),
    staleTime: 5 * 60 * 1000,
  });
  const faqQ = useQuery({
    queryKey: ['help', 'faq'],
    queryFn: () => api('/help/faq'),
    staleTime: 5 * 60 * 1000,
  });

  function toggleDone(slug) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      try {
        localStorage.setItem(HELP_DONE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function toggleFaq(slug) {
    setOpenFaq((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  const loading = indexQ.isLoading || faqQ.isLoading;
  const error = indexQ.error || faqQ.error;

  // /help/index carries the non-FAQ articles; /help/faq carries the FAQ entries (with
  // blocks). One combined list keeps search + audience filtering uniform.
  const articles = indexQ.data?.articles || [];
  const faq = faqQ.data?.faq || [];
  const allItems = [...articles, ...faq];

  const q = search.trim().toLowerCase();
  const matchesSearch = (a) => {
    if (!q) return true;
    const hay = [a.title, a.summary, (a.tags || []).join(' '), a.question]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  };
  // 'all'-audience content (e.g. the password FAQ) is relevant to every role, so it stays
  // visible under any specific audience filter.
  const matchesAudience = (a) => audience === 'all' || a.audience === audience || a.audience === 'all';

  const visible = allItems.filter((a) => matchesSearch(a) && matchesAudience(a));
  const itemsForKind = (kind) => visible.filter((a) => a.kind === kind).sort(byOrder);

  // Guided-path progress reflects the WHOLE onboarding path (audience-filtered, not
  // search-filtered) so the count stays stable while the user searches.
  const getStartedPath = allItems
    .filter((a) => a.kind === 'getting-started' && matchesAudience(a))
    .sort(byOrder);
  const doneCount = getStartedPath.filter((a) => done.has(a.slug)).length;

  const audiencesInData = new Set(allItems.map((a) => a.audience));
  const segOptions = [
    { value: 'all', label: 'All' },
    ...AUDIENCE_SEGMENTS.filter((s) => audiencesInData.has(s.value)),
  ];
  const showSegments = segOptions.length > 1;

  const noMatches = !loading && !error && visible.length === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-fg">Help Center</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Guides, page walkthroughs, and quick answers — tailored to your role.
        </p>
      </div>

      {!loading && !error && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="w-full max-w-sm">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search help…"
              aria-label="Search help"
              leadingIcon={<IconSearch size={16} />}
            />
          </div>
          {showSegments && (
            <Segmented value={audience} onChange={setAudience} options={segOptions} />
          )}
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
          Couldn't load help: {error.message}
        </div>
      ) : noMatches ? (
        <EmptyState
          icon={<IconHelp size={22} />}
          title={q ? 'No results' : 'No help articles yet'}
          hint={q ? 'Try a different search term or clear the audience filter.' : 'Check back soon.'}
        />
      ) : (
        <div className="space-y-8">
          {SECTIONS.map(({ kind, label }) => {
            const items = itemsForKind(kind);
            if (!items.length) return null;

            if (kind === 'getting-started') {
              return (
                <section key={kind}>
                  <div className="mb-3 flex items-center justify-between">
                    <SectionHeading>{label}</SectionHeading>
                    <span className="text-xs font-medium text-fg-subtle">
                      {doneCount} of {getStartedPath.length} complete
                    </span>
                  </div>
                  <ol className="space-y-3">
                    {items.map((item) => (
                      <li key={item.slug}>
                        <LessonRow
                          item={item}
                          index={getStartedPath.findIndex((a) => a.slug === item.slug) + 1}
                          isDone={done.has(item.slug)}
                          onToggle={toggleDone}
                        />
                      </li>
                    ))}
                  </ol>
                </section>
              );
            }

            if (kind === 'faq') {
              return (
                <section key={kind}>
                  <SectionHeading>{label}</SectionHeading>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <FaqRow
                        key={item.slug}
                        item={item}
                        open={openFaq.has(item.slug)}
                        onToggle={() => toggleFaq(item.slug)}
                      />
                    ))}
                  </div>
                </section>
              );
            }

            return (
              <section key={kind}>
                <SectionHeading>{label}</SectionHeading>
                <div className="space-y-2">
                  {items.map((item) => (
                    <ArticleRow key={item.slug} item={item} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
