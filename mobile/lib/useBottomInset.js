import { useContext } from 'react';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// The distance a bottom-anchored element must clear.
//
// The floating tab bar (components/FloatingTabBar.jsx) is absolutely positioned, so it no longer
// occupies layout space the way the stock in-flow bar did — every sheet, toast, action bar and
// scroll bottom on a tab screen has to clear it explicitly or it hides behind it. On a tab screen
// that distance is the bar's REPORTED height (pill + gap + the safe-area inset it already contains);
// off one it is just the inset. `Math.max` covers both with one expression, so call sites swap
// `insets.bottom` for this and stop caring which kind of screen they are on.
//
// Reads the CONTEXT rather than useBottomTabBarHeight(): that hook THROWS when the context is
// undefined ("Are you inside a screen in Bottom Tab Navigator?"), and this is used from components
// shared with the canvasser Stack, which has no tabs at all (PullableSheet is the one that matters).
// `?? 0` is the whole guard.
export const useBottomInset = () => {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext);
  return Math.max(insets.bottom, tabBarHeight ?? 0);
};
