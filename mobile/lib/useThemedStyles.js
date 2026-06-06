import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from './ThemeContext';

// Builds a screen's StyleSheet from a `makeStyles(theme)` factory and rebuilds it
// only when the active scheme flips. This is the RN workaround for the fact that
// a module-level `StyleSheet.create({...})` captures colors at import time and
// can't react to a runtime theme change — so each screen defines a top-level
// `function makeStyles(t) { return StyleSheet.create({ ... t.colors.x ... }); }`
// and calls `const styles = useThemedStyles(makeStyles)` in its component.
//
// `makeStyles` must be a stable (module-level) function. The memo keys on
// `theme.scheme`, so there are at most two StyleSheet instances per screen over
// the app's life.
export function useThemedStyles(makeStyles) {
  const theme = useTheme();
  // The factory reads theme.colors/type/shadow, which all change together with
  // the scheme, so theme.scheme is a sufficient and stable memo key.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => StyleSheet.create(makeStyles(theme)), [theme.scheme, makeStyles]);
}
