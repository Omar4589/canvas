import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import CampaignSelector, { useCampaignSelection } from '../components/CampaignSelector.jsx';

const STATUSES = ['unknocked', 'not_home', 'surveyed', 'wrong_address', 'lit_dropped'];
const STATUS_LABEL = {
  unknocked: 'Unknocked',
  not_home: 'Not home',
  surveyed: 'Surveyed',
  wrong_address: 'Wrong address',
  lit_dropped: 'Lit dropped',
};

const csv = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);

const EMPTY = {
  genders: '', parties: '', precincts: '', congressional: '', stateSenate: '', stateHouse: '',
  cities: '', zips: '', counties: '', ageMin: '', ageMax: '',
  priorPassId: '', priorPassStatuses: [], surveyResponse: 'any', combine: 'and',
};

function buildFilter(f) {
  const out = {};
  const arrs = {
    genders: f.genders, parties: f.parties, precincts: f.precincts,
    congressionalDistricts: f.congressional, stateSenateDistricts: f.stateSenate,
    stateHouseDistricts: f.stateHouse, cities: f.cities, zips: f.zips, counties: f.counties,
  };
  for (const [k, v] of Object.entries(arrs)) {
    const a = csv(v);
    if (a.length) out[k] = a;
  }
  if (f.ageMin) out.ageMin = Number(f.ageMin);
  if (f.ageMax) out.ageMax = Number(f.ageMax);
  if (f.priorPassId) out.priorPassId = f.priorPassId;
  if (f.priorPassStatuses.length) out.priorPassStatuses = f.priorPassStatuses;
  if (f.surveyResponse && f.surveyResponse !== 'any') out.surveyResponse = f.surveyResponse;
  out.combine = f.combine;
  return out;
}

function TextFilter({ label, value, onChange, placeholder }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-gray-700">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
      />
    </label>
  );
}

export default function WalkListsPage() {
  const qc = useQueryClient();
  const { campaignId, setCampaignId, campaigns, isLoading } = useCampaignSelection();
  const [f, setF] = useState(EMPTY);
  const [name, setName] = useState('');
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const listsQ = useQuery({
    queryKey: ['admin', 'walklists', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/walklists`),
    enabled: !!campaignId,
  });
  const passesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes`),
    enabled: !!campaignId,
  });
  const lists = listsQ.data?.walkLists || [];
  const passes = passesQ.data?.passes || [];

  const preview = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/walklists/preview`, { method: 'POST', body: { filter: buildFilter(f) } }),
  });
  const save = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/walklists`, { method: 'POST', body: { name, filter: buildFilter(f) } }),
    onSuccess: () => {
      setName('');
      qc.invalidateQueries({ queryKey: ['admin', 'walklists', campaignId] });
    },
  });
  const del = useMutation({
    mutationFn: (id) => api(`/admin/campaigns/${campaignId}/walklists/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'walklists', campaignId] }),
  });

  function toggleStatus(s) {
    set('priorPassStatuses', f.priorPassStatuses.includes(s)
      ? f.priorPassStatuses.filter((x) => x !== s)
      : [...f.priorPassStatuses, s]);
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Walk Lists</h1>
        <CampaignSelector campaignId={campaignId} onChange={setCampaignId} campaigns={campaigns} isLoading={isLoading} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Builder */}
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-1 text-base font-medium">Build a list</h2>
          <p className="mb-4 text-xs text-gray-500">Comma-separate multiple values. Empty = no restriction. Saved lists are frozen snapshots.</p>

          <div className="mb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Demographics</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <TextFilter label="Genders" value={f.genders} onChange={(v) => set('genders', v)} placeholder="M, F" />
              <TextFilter label="Parties" value={f.parties} onChange={(v) => set('parties', v)} placeholder="DEM, REP" />
              <TextFilter label="Precincts" value={f.precincts} onChange={(v) => set('precincts', v)} placeholder="12, 13" />
              <TextFilter label="Congressional" value={f.congressional} onChange={(v) => set('congressional', v)} />
              <TextFilter label="State senate" value={f.stateSenate} onChange={(v) => set('stateSenate', v)} />
              <TextFilter label="State house" value={f.stateHouse} onChange={(v) => set('stateHouse', v)} />
              <div className="grid grid-cols-2 gap-2">
                <TextFilter label="Age min" value={f.ageMin} onChange={(v) => set('ageMin', v)} placeholder="18" />
                <TextFilter label="Age max" value={f.ageMax} onChange={(v) => set('ageMax', v)} placeholder="35" />
              </div>
            </div>
          </div>

          <div className="mb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Geography</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <TextFilter label="Cities" value={f.cities} onChange={(v) => set('cities', v)} />
              <TextFilter label="ZIPs" value={f.zips} onChange={(v) => set('zips', v)} />
              <TextFilter label="Counties" value={f.counties} onChange={(v) => set('counties', v)} />
            </div>
          </div>

          <div className="mb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Prior round</div>
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-gray-700">From pass</span>
                <select
                  value={f.priorPassId}
                  onChange={(e) => set('priorPassId', e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
                >
                  <option value="">—</option>
                  {passes.map((p) => (
                    <option key={p._id} value={p._id}>Round {p.roundNumber} · {p.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-gray-700">Has survey response</span>
                <select
                  value={f.surveyResponse}
                  onChange={(e) => set('surveyResponse', e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
                >
                  <option value="any">Any</option>
                  <option value="exists">Has a response</option>
                  <option value="not_exists">No response</option>
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              <span className="font-medium text-gray-700">Door status:</span>
              {STATUSES.map((s) => (
                <label key={s} className="flex items-center gap-1">
                  <input type="checkbox" checked={f.priorPassStatuses.includes(s)} onChange={() => toggleStatus(s)} />
                  {STATUS_LABEL[s]}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-xs font-medium text-gray-700">Combine</span>
              <select value={f.combine} onChange={(e) => set('combine', e.target.value)} className="rounded border border-gray-300 px-2 py-1 text-sm">
                <option value="and">AND (match all)</option>
                <option value="or">OR (match any)</option>
              </select>
            </label>
            <button onClick={() => preview.mutate()} disabled={preview.isPending} className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-60">
              {preview.isPending ? 'Counting…' : 'Preview count'}
            </button>
            {preview.data && (
              <span className="text-sm text-gray-700">
                <b>{preview.data.householdCount?.toLocaleString()}</b> households · <b>{preview.data.voterCount?.toLocaleString()}</b> voters
              </span>
            )}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="List name (e.g. Undecideds R1)" className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
            <button onClick={() => name && save.mutate()} disabled={!name || save.isPending} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {save.isPending ? 'Saving…' : 'Save list'}
            </button>
            <button onClick={() => { setF(EMPTY); preview.reset(); }} className="text-xs text-gray-500 hover:underline">Reset</button>
          </div>
          {(save.error || preview.error) && (
            <div className="mt-2 text-xs text-red-700">{(save.error || preview.error).message}</div>
          )}
        </section>

        {/* Saved lists */}
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-base font-medium">Saved lists</h2>
          {listsQ.isLoading ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : !lists.length ? (
            <div className="text-sm text-gray-500">None yet.</div>
          ) : (
            <ul className="space-y-2">
              {lists.map((w) => (
                <li key={w._id} className="rounded border border-gray-100 p-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="truncate font-medium">{w.name}</span>
                    <button onClick={() => del.mutate(w._id)} className="text-xs text-red-600 hover:underline">Delete</button>
                  </div>
                  <div className="text-xs text-gray-500">
                    {w.householdCount?.toLocaleString()} hh · {w.voterCount?.toLocaleString()} voters · {new Date(w.createdAt).toLocaleDateString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
