import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

const STORAGE_KEY = 'canvass.adminCampaignId';

export function getStoredCampaignId() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredCampaignId(id) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

// `overrideId` (from the campaign drill-in URL, useParams) is the source of truth when
// present; the localStorage state is only the fallback for not-yet-migrated screens.
export function useCampaignSelection(overrideId) {
  const [storedId, setStoredId] = useState(getStoredCampaignId());

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });

  const allCampaigns = campaignsQ.data?.campaigns || [];
  const campaigns = allCampaigns.filter((c) => c.isActive);
  const campaignId = overrideId || storedId;

  // Remember the drilled-in campaign as "last used" (for redirects + legacy screens).
  useEffect(() => {
    if (overrideId) setStoredCampaignId(overrideId);
  }, [overrideId]);

  // Legacy (no URL override): clear a stale stored id...
  useEffect(() => {
    if (overrideId || !storedId || !campaigns.length) return;
    if (!campaigns.find((c) => String(c._id) === String(storedId))) {
      setStoredId('');
      setStoredCampaignId('');
    }
  }, [overrideId, storedId, campaigns]);

  // ...and auto-select the first campaign on first load.
  useEffect(() => {
    if (overrideId || storedId) return;
    if (campaigns.length > 0) {
      const first = String(campaigns[0]._id);
      setStoredId(first);
      setStoredCampaignId(first);
    }
  }, [overrideId, storedId, campaigns]);

  function update(id) {
    setStoredId(id);
    setStoredCampaignId(id);
  }

  const selected = allCampaigns.find((c) => String(c._id) === String(campaignId)) || null;

  return { campaignId, setCampaignId: update, campaigns, selected, isLoading: campaignsQ.isLoading };
}

export default function CampaignSelector({ campaignId, onChange, campaigns, isLoading }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">
        Campaign
      </span>
      <select
        value={campaignId || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={isLoading}
        className="rounded border border-border-strong bg-card px-2 py-1 text-sm text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        {isLoading && <option value="">Loading…</option>}
        {!isLoading && !campaigns?.length && (
          <option value="">No active campaigns</option>
        )}
        {(campaigns || []).map((c) => (
          <option key={c._id} value={c._id}>
            {c.name} ({c.type === 'survey' ? 'Survey' : 'Lit drop'})
          </option>
        ))}
      </select>
    </div>
  );
}
