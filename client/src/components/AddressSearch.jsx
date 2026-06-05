import { useMemo, useState } from 'react';

function normalize(s) {
  return (s || '').toLowerCase().trim();
}

export default function AddressSearch({ households = [], onSelect }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const term = normalize(q);
    if (term.length < 2) return [];
    return households
      .filter((h) => {
        const hay = `${h.addressLine1} ${h.city} ${h.state} ${h.zipCode}`.toLowerCase();
        return hay.includes(term);
      })
      .slice(0, 8);
  }, [q, households]);

  return (
    <div className="relative w-72">
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search address…"
        className="w-full rounded border border-border bg-card px-3 py-1.5 text-sm focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      {open && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-card shadow-lg">
          {matches.map((h) => (
            <button
              key={h.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(h);
                setQ('');
                setOpen(false);
              }}
              className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-sunken"
            >
              <div className="truncate font-medium text-fg">{h.addressLine1}</div>
              <div className="truncate text-xs text-fg-muted">
                {h.city}, {h.state} {h.zipCode}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
