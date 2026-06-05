// Square icon-only button. aria-label is required for accessibility.
const VARIANTS = {
  ghost: 'text-fg-muted hover:bg-sunken hover:text-fg',
  subtle: 'text-fg-subtle hover:bg-sunken hover:text-fg-muted',
};

export default function IconButton({
  label,
  variant = 'ghost',
  className = '',
  type = 'button',
  children,
  ...rest
}) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-md p-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card ${VARIANTS[variant] || VARIANTS.ghost} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
