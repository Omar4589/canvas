import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { Appearance } from 'react-native';
import { buildTheme } from './theme';
import { loadThemePreference, saveThemePreference } from './cache';

// Light/dark theme for the mobile app — the RN analog of the web's class-based
// dark mode. `preference` ('light' | 'dark' | 'system') is what the user picks
// and what persists; `scheme` ('light' | 'dark') is the resolved active value
// ('system' resolves from the live OS setting). Screens read this via
// `useTheme()` and build their styles with `useThemedStyles(makeStyles)`.
const ThemeContext = createContext(null);

function resolveScheme(preference, osScheme) {
  if (preference === 'light' || preference === 'dark') return preference;
  return osScheme === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState('system');
  // Seed from the OS synchronously so the very first paint is already in the
  // right scheme for a system/first-run user (no flash); an explicit stored
  // choice loads a tick later and is gated by app/index.jsx until `loaded`.
  const [osScheme, setOsScheme] = useState(() => Appearance.getColorScheme() || 'light');
  const [loaded, setLoaded] = useState(false);

  // Boot: load the persisted preference once.
  useEffect(() => {
    let mounted = true;
    loadThemePreference()
      .then((pref) => {
        if (!mounted) return;
        if (pref === 'light' || pref === 'dark' || pref === 'system') setPreference(pref);
      })
      .finally(() => {
        if (mounted) setLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Track OS scheme changes so a 'system' preference updates live.
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setOsScheme(colorScheme || 'light');
    });
    return () => sub.remove();
  }, []);

  const scheme = resolveScheme(preference, osScheme);

  // Keep native UI (Alert, keyboard, date picker, action sheets, scrollbars) in
  // step with the in-app choice. An explicit choice forces the app-wide scheme;
  // 'system' clears the override (null) so RN follows the OS again — and we
  // re-read the true OS value there, since forcing a scheme earlier makes the
  // Appearance listener report the forced value rather than the real OS setting.
  useEffect(() => {
    if (preference === 'system') {
      Appearance.setColorScheme(null);
      setOsScheme(Appearance.getColorScheme() || 'light');
    } else {
      Appearance.setColorScheme(scheme);
    }
  }, [preference, scheme]);

  const setScheme = useCallback((pref) => {
    setPreference(pref);
    saveThemePreference(pref).catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    setScheme(scheme === 'dark' ? 'light' : 'dark');
  }, [scheme, setScheme]);

  const value = useMemo(() => {
    const t = buildTheme(scheme);
    return { ...t, preference, loaded, setScheme, toggle };
  }, [scheme, preference, loaded, setScheme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
