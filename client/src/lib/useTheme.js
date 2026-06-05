import { useEffect, useState } from 'react';

// Light/dark theme via Tailwind's class strategy. The initial `.dark` class is set
// before paint by the inline script in index.html (from localStorage or the OS
// preference); this hook reads that state, toggles it, and persists the choice.
export function useTheme() {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}
