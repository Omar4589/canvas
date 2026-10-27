import Overlay from './Overlay.jsx';
import IconButton from './IconButton.jsx';
import { IconX } from './icons.jsx';

// Edge-anchored slide-over on the shared Overlay (right side by default).
//
// `header` replaces the title row with the caller's own (the person panel's ‹ › "3 of 45" and its
// guarded close); the caller then renders its own close button. `bodyRef` reaches the scroll box, so
// a drawer that swaps its content in place (stepping to the next person) can reset its scroll — the
// same reason Modal has one.
export default function Drawer({ onClose, title, header, side = 'right', width = 'max-w-md', className = '', bodyRef, children }) {
  return (
    <Overlay onClose={onClose} align={side} className={`h-full w-full ${width}`}>
      <div
        className={`flex h-full animate-slide-in flex-col border-border bg-card shadow-overlay ${
          side === 'right' ? 'border-l' : 'border-r'
        } ${className}`}
      >
        {header ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3">{header}</div>
        ) : (
          (title || onClose) && (
            <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
              {title && <h2 className="text-lg font-semibold text-fg">{title}</h2>}
              {onClose && (
                <IconButton label="Close" onClick={onClose} className="-mr-1">
                  <IconX size={20} />
                </IconButton>
              )}
            </div>
          )
        )}
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto">
          {children}
        </div>
      </div>
    </Overlay>
  );
}
