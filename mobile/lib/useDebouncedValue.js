import { useEffect, useState } from 'react';

// Returns `value` after it has been stable for `delay` ms. Used to keep
// search-as-you-type inputs from firing a network request per keystroke.
export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
