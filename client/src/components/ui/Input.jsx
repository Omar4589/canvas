// Token-based form fields. Shared focus/disabled treatment; dark-ready.
// Inputs/Textareas default to full width; Select is width-agnostic (add w-full
// for form selects, leave bare for compact toolbar selects).
const FIELD =
  'rounded-lg border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle transition-colors hover:border-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60';

export function Input({ className = '', leadingIcon = null, ...rest }) {
  if (leadingIcon) {
    return (
      <div className="relative w-full">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">
          {leadingIcon}
        </span>
        <input className={`${FIELD} w-full pl-9 ${className}`} {...rest} />
      </div>
    );
  }
  return <input className={`${FIELD} w-full ${className}`} {...rest} />;
}

export function Select({ className = '', children, ...rest }) {
  return (
    <select className={`${FIELD} ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className = '', ...rest }) {
  return <textarea className={`${FIELD} w-full ${className}`} {...rest} />;
}

export { FIELD as FIELD_CLS };
