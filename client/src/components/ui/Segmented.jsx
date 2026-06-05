// Segmented control. options: [{ value, label }]. Token active state.
export default function Segmented({ options = [], value, onChange, size = 'md', className = '' }) {
  const pad = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm';
  return (
    <div className={`inline-flex rounded-lg border border-border bg-sunken p-0.5 ${className}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${pad} ${
              active ? 'bg-card text-fg shadow-card' : 'text-fg-muted hover:text-fg'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
