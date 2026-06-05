// Centered empty/zero state: icon-in-circle + title + hint + optional action.
export default function EmptyState({ icon = null, title, hint = null, action = null, className = '' }) {
  return (
    <div className={`px-4 py-14 text-center ${className}`}>
      {icon && (
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sunken text-fg-subtle">
          {icon}
        </div>
      )}
      {title && <div className="text-sm font-medium text-fg">{title}</div>}
      {hint && <div className="mt-1 text-sm text-fg-muted">{hint}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
