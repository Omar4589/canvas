import { isTemporaryError } from './lifecycleCopy.js';

export const DANGER_BOX = 'rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-fg';
export const WARN_BOX = 'rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-sm text-warning-fg';
export const NOTE_BOX = 'rounded-md border border-border bg-sunken px-3 py-2 text-sm text-fg-muted';

// A server refusal, in its own sentence. A temporary one (someone is mid-change: "Try again in a
// minute") reads as a warning, not a failure — nothing changed.
const RefusalBox = ({ error }) =>
  error ? (
    <div role="alert" className={isTemporaryError(error) ? WARN_BOX : DANGER_BOX}>
      {error.message}
    </div>
  ) : null;

export default RefusalBox;
