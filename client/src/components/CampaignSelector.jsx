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

function setStoredCampaignId(id) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function useCampaignSelection() {
  const [campaignId, setCampaignId] = useState(getStoredCampaignId());

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });

  const campaigns = (campaignsQ.data?.campaigns || []).filter((c) => c.isActive);

  // If the stored campaign no longer exists, clear it.
  useEffect(() => {
    if (!campaignId || !campaigns.length) return;
    if (!campaigns.find((c) => String(c._id) === String(campaignId))) {
      setCampaignId('');
      setStoredCampaignId('');
    }
  }, [campaignId, campaigns]);

  // Auto-select the first campaign on first load if none chosen.
  useEffect(() => {
    if (campaignId) return;
    if (campaigns.length > 0) {
      const first = String(campaigns[0]._id);
      setCampaignId(first);
      setStoredCampaignId(first);
    }
  }, [campaignId, campaigns]);

  function update(id) {
    setCampaignId(id);
    setStoredCampaignId(id);
  }

  const selected = campaigns.find((c) => String(c._id) === String(campaignId)) || null;

  return { campaignId, setCampaignId: update, campaigns, selected, isLoading: campaignsQ.isLoading };
}

export default function CampaignSelector({ campaignId, onChange, campaigns, isLoading }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Campaign
      </span>
      <select
        value={campaignId || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={isLoading}
        className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
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
