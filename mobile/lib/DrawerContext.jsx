import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { useSharedValue, withTiming, Easing, runOnJS } from 'react-native-reanimated';

// Drives the canvasser slide-out drawer. Mounted once in (app)/_layout.jsx so
// any canvasser screen can open the shared drawer via the header hamburger
// (`useDrawer().openDrawer()`) without prop-drilling or per-screen overlays.
//
// `progress` (0 = closed, 1 = open) is a reanimated shared value the panel reads
// to slide in + fade its backdrop. `isOpen` is plain JS state used to mount the
// overlay only while it's needed — when closed the drawer renders nothing, so it
// never intercepts touches on the map underneath (the key correctness property).
const DrawerContext = createContext(null);

// Smooth ease, no bounce — matches the map's PullableSheet timing.
const DRAWER_TIMING = { duration: 240, easing: Easing.out(Easing.cubic) };

export function DrawerProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const progress = useSharedValue(0);

  const openDrawer = useCallback(() => {
    setIsOpen(true); // mount immediately, then slide in
    progress.value = withTiming(1, DRAWER_TIMING);
  }, [progress]);

  const closeDrawer = useCallback(() => {
    // Slide out, and only unmount once the animation finishes so the panel stays
    // visible (and interactive) while it leaves.
    progress.value = withTiming(0, DRAWER_TIMING, (finished) => {
      if (finished) runOnJS(setIsOpen)(false);
    });
  }, [progress]);

  const value = useMemo(
    () => ({ isOpen, openDrawer, closeDrawer, progress }),
    [isOpen, openDrawer, closeDrawer, progress]
  );

  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>;
}

export function useDrawer() {
  const ctx = useContext(DrawerContext);
  if (!ctx) throw new Error('useDrawer must be used within a DrawerProvider');
  return ctx;
}
