import { useState } from 'react';
import { FIELD_CLS } from './ui/Input.jsx';
import { IconEye, IconEyeOff } from './ui/icons.jsx';

export default function PasswordInput({
  value,
  onChange,
  placeholder,
  required,
  autoComplete = 'current-password',
  className = '',
  disabled,
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        disabled={disabled}
        className={`${FIELD_CLS} w-full pr-10 ${className}`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-2 flex items-center text-fg-subtle hover:text-fg-muted"
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <IconEyeOff size={18} /> : <IconEye size={18} />}
      </button>
    </div>
  );
}
