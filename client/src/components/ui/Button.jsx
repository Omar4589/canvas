import { IconSpinner } from './icons.jsx';

// Variants: primary (solid brand — the ONE solid red), secondary (outline),
// danger (ghost/outline red so it never reads like the primary CTA), ghost.
const VARIANTS = {
  primary:
    'bg-brand-600 text-white shadow-card hover:bg-brand-700 disabled:opacity-60',
  secondary:
    'border border-border-strong bg-card text-fg hover:bg-sunken disabled:opacity-60',
  danger:
    'border border-danger/30 bg-transparent text-danger hover:bg-danger-tint disabled:opacity-60',
  ghost:
    'bg-transparent text-fg-muted hover:bg-sunken hover:text-fg disabled:opacity-60',
};
const SIZES = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3.5 py-2 text-sm',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed ${VARIANTS[variant] || VARIANTS.primary} ${SIZES[size] || SIZES.md} ${className}`}
      {...rest}
    >
      {loading && <IconSpinner size={16} />}
      {children}
    </button>
  );
}
