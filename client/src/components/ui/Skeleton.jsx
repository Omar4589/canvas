// Loading placeholder. `bg-sunken` + pulse; reduced-motion users get a static block
// (the global prefers-reduced-motion rule neutralizes the animation).
export default function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded bg-sunken ${className}`} />;
}

// A table-ish stack of shimmering rows for list/table loading states.
export function SkeletonRows({ rows = 6 }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-56 opacity-60" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}
