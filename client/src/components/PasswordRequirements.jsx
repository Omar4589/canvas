import { passwordChecklist } from '../lib/validators.js';
import { IconCheck } from './ui/icons.jsx';

// Live checklist for a USER-CHOSEN password — the rules mirror server/src/utils/validators.js
// (the real guard). Renders nothing until the user starts typing, then ticks each rule green
// as it's satisfied. Used under the "new password" field on the change-password / profile flows.
export default function PasswordRequirements({ password }) {
  if (!password) return null;
  const items = passwordChecklist(password);
  return (
    <ul className="mt-2 space-y-1" aria-label="Password requirements">
      {items.map((it) => (
        <li
          key={it.key}
          className={`flex items-center gap-1.5 text-xs ${
            it.ok ? 'text-success' : 'text-fg-subtle'
          }`}
        >
          <span
            className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
              it.ok ? 'border-success bg-success-tint' : 'border-border-strong'
            }`}
          >
            {it.ok ? <IconCheck size={10} /> : null}
          </span>
          {it.label}
        </li>
      ))}
    </ul>
  );
}
