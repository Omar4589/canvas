// Token-based form fields. Shared focus/disabled treatment; dark-ready.
const FIELD =
  'w-full rounded-lg border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle transition-colors hover:border-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60';

export function Input({ className = '', leadingIcon = null, ...rest }) {
  if (leadingIcon) {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">
          {leadingIcon}
        </span>
        <input className={`${FIELD} pl-9 ${className}`} {...rest} />
      </div>
    );
  }
  return <input className={`${FIELD} ${className}`} {...rest} />;
}

export function Select({ className = '', children, ...rest }) {
  return (
    <select className={`${FIELD} ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className = '', ...rest }) {
  return <textarea className={`${FIELD} ${className}`} {...rest} />;
}

export { FIELD as FIELD_CLS };
