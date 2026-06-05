import { Popover } from './ui/Popover.jsx';

// A small "(i)" button that toggles a short explanatory popover. Now built on the
// shared Popover (outside-click + Esc dismiss), token-themed.
//   <InfoHint label="What is X?">Some explanation…</InfoHint>
export default function InfoHint({ children, label = 'More info', className = '' }) {
  const trigger = (
    <span
      aria-label={label}
      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border-strong text-[10px] font-bold leading-none text-fg-muted hover:bg-sunken hover:text-fg"
    >
      i
    </span>
  );
  return (
    <span className={`inline-flex ${className}`}>
      <Popover trigger={trigger} width="w-64" className="text-xs font-normal leading-relaxed text-fg-muted">
        {children}
      </Popover>
    </span>
  );
}
