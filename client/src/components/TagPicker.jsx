import { useState } from 'react';

// Single-select tag combobox backed by the org Tag library. Mirrors the
// MultiSelect interaction in WalkListsPage (focus opens a dropdown, onBlur
// closes after ~120ms, option buttons use onMouseDown+preventDefault so the
// click lands before blur, case-insensitive filtering) but selects exactly one
// tag. Picking an existing tag is the default; creating a new one is an explicit
// "Create <text>" action that only appears when nothing matches — this keeps
// the owner's picklist from fracturing on typos.
//
// Props:
//   value    — the current tag name string (or null/empty for none)
//   onChange — called with the chosen name, or null to clear
//   tags     — array of org-library tag objects, each with a `name`
//   onCreate — async (name) => canonical name; creates an org tag server-side
export default function TagPicker({ value, onChange, tags = [], onCreate }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // A tag is selected → show it as a clearable chip instead of the input.
  if (value) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-brand-tint px-1.5 py-0.5 text-xs text-brand-accent">
        {value}
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-brand-accent hover:text-brand-accent"
          aria-label={`Clear tag ${value}`}
        >
          ×
        </button>
      </span>
    );
  }

  const q = query.trim();
  const lower = q.toLowerCase();
  const filtered = tags
    .filter((t) => (t.name || '').toLowerCase().includes(lower))
    .slice(0, 50);
  const exactMatch = tags.some((t) => (t.name || '').toLowerCase() === lower);
  const showCreate = !!q && !exactMatch;

  async function create() {
    if (!q || creating) return;
    setCreating(true);
    try {
      const name = await onCreate(q);
      onChange(name);
      setQuery('');
      setOpen(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="relative">
      <input
        value={query}
        autoComplete="off"
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Pick or create a tag…"
        className="w-44 rounded border border-border-strong bg-card px-2 py-1 text-xs text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      {open && (filtered.length > 0 || showCreate) && (
        <ul className="absolute left-0 top-full z-20 mt-1 max-h-48 w-44 overflow-auto rounded border border-border bg-card py-1 text-xs shadow-lg">
          {filtered.map((t) => (
            <li key={t.name}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onChange(t.name); setQuery(''); setOpen(false); }}
                className="block w-full px-2 py-1 text-left hover:bg-brand-tint"
              >
                {t.name}
              </button>
            </li>
          ))}
          {showCreate && (
            <li className={filtered.length ? 'border-t border-border' : ''}>
              <button
                type="button"
                disabled={creating}
                onMouseDown={(e) => { e.preventDefault(); create(); }}
                className="block w-full px-2 py-1 text-left font-medium text-brand-accent hover:bg-brand-tint disabled:opacity-60"
              >
                {creating ? 'Creating…' : `Create “${q}”`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
