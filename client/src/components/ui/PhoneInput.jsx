import { Input } from './Input.jsx';
import { formatUsPhoneInput } from '../../lib/validators.js';

// A phone field that auto-formats to (555) 123-4567 as you type and can't hold letters.
// It re-emits a normal-looking change event ({ target: { value } }) so call sites keep
// their existing `onChange={(e) => ...e.target.value}` handlers unchanged.
export default function PhoneInput({ value, onChange, ...props }) {
  return (
    <Input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="(555) 123-4567"
      value={value || ''}
      onChange={(e) => onChange({ target: { value: formatUsPhoneInput(e.target.value) } })}
      {...props}
    />
  );
}
