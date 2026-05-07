// Doorline brand mark — web port of mobile/components/Logo.jsx.
// Red map-pin silhouette with a white doorway cut-out + tiny knob.

export function LogoMark({ size = 32 }) {
  const height = size * (44 / 36);
  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 36 44"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M18 0 C8.06 0 0 8.06 0 18 C0 29.5 12 36.5 17 43.2 C17.5 43.9 18.5 43.9 19 43.2 C24 36.5 36 29.5 36 18 C36 8.06 27.94 0 18 0 Z"
        fill="#DC2626"
      />
      <path
        d="M12 11 L12 26 L24 26 L24 11 C24 8.79 22.21 7 20 7 L16 7 C13.79 7 12 8.79 12 11 Z"
        fill="#ffffff"
      />
      <rect x="20.4" y="17.2" width="1.8" height="1.8" rx="0.9" fill="#DC2626" />
    </svg>
  );
}

export default function Logo({ size = 28, hideText = false, className = '' }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      {!hideText && (
        <span
          className="font-bold text-gray-900"
          style={{ fontSize: size * 0.78, letterSpacing: '-0.5px' }}
        >
          Doorline
        </span>
      )}
    </div>
  );
}
