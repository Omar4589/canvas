import Overlay from './Overlay.jsx';
import IconButton from './IconButton.jsx';
import { IconX } from './icons.jsx';

// Centered dialog on the shared Overlay. <Modal onClose title=…>body</Modal>.
export default function Modal({ onClose, title, subtitle, footer, size = 'xl', className = '', children }) {
  const maxW = { md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl', '2xl': 'max-w-2xl' }[size] || 'max-w-xl';
  return (
    <Overlay onClose={onClose} align="center" className={`my-8 w-full ${maxW} px-4`}>
      <div className={`animate-pop-in rounded-card border border-border bg-card shadow-overlay ${className}`}>
        {(title || onClose) && (
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
            <div>
              {title && <h2 className="text-lg font-semibold text-fg">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p>}
            </div>
            {onClose && (
              <IconButton label="Close" onClick={onClose} className="-mr-1">
                <IconX size={20} />
              </IconButton>
            )}
          </div>
        )}
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-6 py-3">{footer}</div>}
      </div>
    </Overlay>
  );
}
