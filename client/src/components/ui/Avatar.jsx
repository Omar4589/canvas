// Initials avatar + overlapping group. Lifted from the Users page preview.
function initials(user) {
  return ((user?.firstName?.[0] || '') + (user?.lastName?.[0] || '')).toUpperCase() || '?';
}

const SIZES = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-9 w-9 text-xs',
};

export function Avatar({ user, name, size = 'md', className = '' }) {
  const label = user ? initials(user) : (name || '?').slice(0, 2).toUpperCase();
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-tint font-semibold text-brand-tint-fg ring-1 ring-brand-accent/15 ${SIZES[size] || SIZES.md} ${className}`}
    >
      {label}
    </span>
  );
}

// users: [{ id, firstName, lastName }]; shows up to `max`, then "+N".
export function AvatarGroup({ users = [], max = 3 }) {
  if (!users.length) return null;
  const shown = users.slice(0, max);
  const title = users.map((u) => `${u.firstName} ${u.lastName}`).join(', ');
  return (
    <span className="flex items-center -space-x-1" title={title}>
      {shown.map((u) => (
        <span
          key={u.id}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-tint text-[9px] font-semibold text-brand-tint-fg ring-1 ring-card"
        >
          {initials(u)}
        </span>
      ))}
      {users.length > max && (
        <span className="pl-1.5 text-[10px] text-fg-subtle">+{users.length - max}</span>
      )}
    </span>
  );
}
