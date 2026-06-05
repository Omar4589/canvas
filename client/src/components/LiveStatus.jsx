import { useEffect, useState } from 'react';

// Compact "live refresh" status pill + toggle for the map toolbar. Owns its own
// 1s ticker so only this chip re-renders each second (not the whole map page),
// keeping the "updated Xs ago" label fresh without churning the Mapbox layers.
function agoLabel(updatedAt, now) {
  if (!updatedAt) return 'just now';
  const s = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
}

export default function LiveStatus({ live, onToggle, isFetching, updatedAt, onRefresh }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  let label;
  if (live && isFetching) label = 'Updating…';
  else if (live) label = `Live · updated ${agoLabel(updatedAt, now)}`;
  else label = 'Paused';

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={live}
        title={live ? 'Pause live refresh' : 'Resume live refresh'}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-medium transition-colors hover:bg-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span
          className={[
            'inline-block h-2 w-2 rounded-full',
            live ? 'bg-green-500' : 'bg-gray-400',
            live && !isFetching ? 'animate-pulse' : '',
          ].join(' ')}
          aria-hidden="true"
        />
        <span className={live ? 'text-fg-muted' : 'text-fg-muted'}>{label}</span>
      </button>
      {!live && (
        <button
          type="button"
          onClick={onRefresh}
          className="rounded font-medium text-brand-accent underline-offset-2 transition-colors hover:text-brand-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Refresh
        </button>
      )}
    </span>
  );
}
