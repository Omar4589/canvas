import { Link } from 'react-router-dom';

// A small "you just did X — here's the next step" banner. Generalizes the Intake
// banner pattern (EffortsPage) into one reusable signpost so every transition in
// the setup chain points forward. Token-based, light/dark ready.
//
//   <NextStepBanner tone="info" title="Import queued."
//      action={{ label: 'Go to Efforts', to: '/efforts', onClick: scopeCampaign }}>
//      Doors land in Intake until an effort claims them.
//   </NextStepBanner>
const TONES = {
  info: 'border-info/30 bg-info-tint text-info-fg',
  success: 'border-success/30 bg-success-tint text-success-fg',
  warning: 'border-warning/30 bg-warning-tint text-warning-fg',
  danger: 'border-danger/30 bg-danger-tint text-danger-fg',
};

export default function NextStepBanner({ tone = 'info', title, children, action = null, className = '' }) {
  const actionCls = 'shrink-0 font-semibold underline underline-offset-2 hover:opacity-80';
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-md border px-4 py-2.5 text-sm ${TONES[tone] || TONES.info} ${className}`}
    >
      <div className="min-w-0">
        {title && <span className="font-semibold">{title} </span>}
        {children}
      </div>
      {action &&
        (action.to ? (
          <Link to={action.to} onClick={action.onClick} className={actionCls}>
            {action.label} →
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className={actionCls}>
            {action.label} →
          </button>
        ))}
    </div>
  );
}
