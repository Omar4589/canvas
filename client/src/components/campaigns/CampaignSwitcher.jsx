import { useNavigate } from 'react-router-dom';
import { Skeleton } from '../ui/index.js';

// The campaign box under "‹ Campaigns" in the drilled-in sidebar (Layout). Three states:
//
//   - The list hasn't loaded: a placeholder bar the select's height. Not the word "Campaign" — the
//     query cache is cleared at every sign-in, so for a team lead who now lands straight in their
//     one campaign this is the first thing the sidebar shows.
//   - Loaded, with somewhere else to go: the switcher <select>, as it always was.
//   - Loaded, with nowhere else to go (one active campaign — the usual case for a team lead who is
//     the client), or the list failed: the campaign's name as plain text. A one-option dropdown is a
//     dead control, and a bordered box with no arrow reads as a broken input, so the text has no
//     visible box; the transparent border keeps the select's height so nothing shifts.
//
// `campaigns` is Layout's pickerCampaigns: active campaigns plus the current one even when archived.
// `loaded` is true once the list answered or failed for good — tested on data, never on isSuccess,
// which a failed background refetch turns false while the data is still there.
const CampaignSwitcher = ({ campaignId, currentSlug, campaigns, loaded }) => {
  const navigate = useNavigate();
  if (!loaded) return <Skeleton className="mt-1 h-[34px] w-full" />;

  const id = String(campaignId);
  const current = campaigns.find((c) => String(c._id) === id);
  const name = current?.name || 'Campaign';
  const archived = current?.isActive === false;
  // "Somewhere else", not "two or more": the current campaign can be missing from the list (a stale
  // link, a revoked grant) while one other campaign is there — that must stay one click away.
  const elsewhere = campaigns.some((c) => String(c._id) !== id);

  if (!elsewhere) {
    return (
      <div
        title={name}
        className="mt-1 truncate border border-transparent px-2 py-1.5 text-sm font-semibold text-fg"
      >
        {name}
        {archived ? ' · Archived' : ''}
      </div>
    );
  }

  return (
    <select
      value={campaignId}
      onChange={(e) => navigate(`/campaigns/${e.target.value}${currentSlug ? '/' + currentSlug : ''}`)}
      title="Switch campaign"
      aria-label="Switch campaign"
      className="mt-1 w-full rounded border border-border-strong bg-card px-2 py-1.5 text-sm font-semibold text-fg focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      {/* Covers the case the list can't: a campaign this viewer's list doesn't contain (a lead's
          scope, or one deleted under a stale cache). Without it the select would render blank. */}
      {!current && <option value={campaignId}>{name}</option>}
      {campaigns.map((c) => (
        <option key={c._id} value={c._id}>
          {c.name}
          {c.isActive === false ? ' · Archived' : ''}
        </option>
      ))}
    </select>
  );
};

export default CampaignSwitcher;
