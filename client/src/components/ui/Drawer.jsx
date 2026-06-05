import Overlay from './Overlay.jsx';
import IconButton from './IconButton.jsx';
import { IconX } from './icons.jsx';

// Edge-anchored slide-over on the shared Overlay (right side by default).
export default function Drawer({ onClose, title, side = 'right', width = 'max-w-md', className = '', children }) {
  return (
    <Overlay onClose={onClose} align={side} className={`h-full w-full ${width}`}>
      <div
        className={`flex h-full animate-slide-in flex-col border-border bg-card shadow-overlay ${
          side === 'right' ? 'border-l' : 'border-r'
        } ${className}`}
      >
        {(title || onClose) && (
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
            {title && <h2 className="text-lg font-semibold text-fg">{title}</h2>}
            {onClose && (
              <IconButton label="Close" onClick={onClose} className="-mr-1">
                <IconX size={20} />
              </IconButton>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </Overlay>
  );
}
