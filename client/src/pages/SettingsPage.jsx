import { useQuery } from '@tanstack/react-query';
import { Button, Card, Skeleton } from '../components/ui/index.js';
import PacePauseSettingsCard, { settingsQuery } from '../components/settings/PacePauseSettingsCard.jsx';

// The organization's Settings page (docs/PROPOSAL_PEOPLE_PAGES.md §C): switches that cover every
// campaign. Today that is Automatic pause, which used to sit above the Users page's member list. Org
// admins only (App.jsx's orgAdmin RoleGate; GET /admin/pace-pauses/settings refuses anyone else). Only a
// billing admin can change it; other org admins see it read-only. The setting stays on the web, in this
// one place: no link from the Audit page, no row on the phone.
const SettingsPage = () => {
  const q = useQuery(settingsQuery);
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Settings</h1>
        <p className="text-sm text-fg-muted">Automatic pause, for every campaign in your organization.</p>
      </div>
      {q.isLoading ? (
        <Card className="mb-6 space-y-3 p-5" aria-busy="true">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-full max-w-xl" />
          <Skeleton className="h-3 w-3/4 max-w-lg" />
          <Skeleton className="mt-4 h-24 w-full max-w-xl" />
        </Card>
      ) : q.isError ? (
        <Card className="mb-6 flex flex-wrap items-center gap-3 p-5 text-sm">
          <span className="text-danger-fg">Couldn’t load —</span>
          <Button variant="secondary" size="sm" disabled={q.isFetching} onClick={() => q.refetch()}>
            Retry
          </Button>
        </Card>
      ) : (
        <PacePauseSettingsCard />
      )}
    </div>
  );
};

export default SettingsPage;
