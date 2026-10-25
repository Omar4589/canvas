import Overlay from './Overlay.jsx';
import IconButton from './IconButton.jsx';
import { IconX } from './icons.jsx';

// Centered dialog on the shared Overlay. <Modal onClose title=…>body</Modal>.
//
// The card is a HEIGHT-CAPPED FLEX COLUMN whose body is the scroll region — the same
// min-h-0 chain Drawer.jsx uses. Overlay locks body scroll, so a card taller than the
// viewport used to be clipped with no way to reach the rest: on a long confirm dialog that
// put the footer's own Cancel/confirm buttons off-screen. Header and footer stay pinned
// (shrink-0) so the action buttons are always reachable no matter how long the body runs.
// The cap matches the Overlay wrapper's my-8 (4rem total) so a maxed card sits flush in it.
//
// `bodyRef` reaches that scroll box. A modal that swaps its own content in place (the door-by-door
// walkthrough advancing to the next address) reuses this node, so its scrollTop carries over into
// content it does not belong to; such a caller resets it here.
//
// `closable={false}` holds the dialog open: no close button, and the scrim and Escape do nothing.
// For the moment an answer has to land on this dialog — a permanent delete in flight, say.
export default function Modal({ onClose, title, subtitle, footer, size = 'xl', className = '', bodyRef, closable = true, children }) {
  const maxW = { md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl', '2xl': 'max-w-2xl' }[size] || 'max-w-xl';
  const close = closable ? onClose : undefined;
  return (
    <Overlay onClose={close} align="center" className={`my-8 w-full ${maxW} px-4`}>
      <div
        className={`animate-pop-in flex max-h-[calc(100vh-4rem)] flex-col rounded-card border border-border bg-card shadow-overlay ${className}`}
      >
        {(title || close) && (
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
            <div>
              {title && <h2 className="text-lg font-semibold text-fg">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p>}
            </div>
            {close && (
              <IconButton label="Close" onClick={close} className="-mr-1">
                <IconX size={20} />
              </IconButton>
            )}
          </div>
        )}
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-3">{footer}</div>
        )}
      </div>
    </Overlay>
  );
}
