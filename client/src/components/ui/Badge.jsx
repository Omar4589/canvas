// One pill to replace the scattered badge dialects. Token-based, dark-ready.
// <Badge variant="success" dot>Active</Badge>
const VARIANTS = {
  neutral: 'bg-sunken text-fg-muted',
  brand: 'bg-brand-tint text-brand-tint-fg ring-1 ring-inset ring-brand-accent/15',
  success: 'bg-success-tint text-success-fg ring-1 ring-inset ring-success/20',
  warning: 'bg-warning-tint text-warning-fg ring-1 ring-inset ring-warning/20',
  danger: 'bg-danger-tint text-danger-fg ring-1 ring-inset ring-danger/20',
  info: 'bg-info-tint text-info-fg ring-1 ring-inset ring-info/20',
};
const DOT = {
  neutral: 'bg-fg-subtle',
  brand: 'bg-brand-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export default function Badge({ variant = 'neutral', dot = false, className = '', children }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${VARIANTS[variant] || VARIANTS.neutral} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${DOT[variant] || DOT.neutral}`} />}
      {children}
    </span>
  );
}
