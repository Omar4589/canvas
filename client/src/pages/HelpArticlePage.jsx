import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import HelpBlocks from '../components/help/HelpBlocks.jsx';
import { EmptyState, Button, Skeleton, IconHelp } from '../components/ui/index.js';

// A single help article (route /help/:slug). GET /help/articles/:slug returns the article
// WITH blocks, 404 if it's missing or outside the caller's role — either way we show a
// friendly not-found with a link back.

function BackLink() {
  return (
    <Link
      to="/help"
      className="inline-flex items-center gap-1 text-sm font-medium text-fg-muted transition-colors hover:text-brand-accent"
    >
      ‹ Help Center
    </Link>
  );
}

export default function HelpArticlePage() {
  const { slug } = useParams();

  const q = useQuery({
    queryKey: ['help', 'article', slug],
    queryFn: () => api(`/help/articles/${slug}`),
    retry: false,
  });
  const article = q.data?.article;

  useEffect(() => {
    document.title = article ? `${article.title} · Help` : 'Help';
  }, [article]);

  return (
    <div className="mx-auto max-w-3xl">
      <BackLink />

      {q.isLoading ? (
        <div className="mt-4 space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full max-w-md" />
          <div className="space-y-3 pt-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
      ) : q.isError || !article ? (
        <EmptyState
          icon={<IconHelp size={22} />}
          title="Article not found"
          hint="This help article doesn't exist, or isn't available for your role."
          action={
            <Link to="/help">
              <Button variant="secondary">Back to Help Center</Button>
            </Link>
          }
        />
      ) : (
        <article className="mt-4">
          <h1 className="text-2xl font-semibold text-fg">{article.title}</h1>
          {article.summary && <p className="mt-1 text-sm text-fg-muted">{article.summary}</p>}
          <div className="mt-6">
            <HelpBlocks blocks={article.blocks || []} />
          </div>
        </article>
      )}
    </div>
  );
}
