import { View, Pressable, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { radius, spacing } from '../lib/theme';
import { useBottomInset } from '../lib/useBottomInset';
import { useThemedStyles } from '../lib/useThemedStyles';

export const SHEET_TIMING = { duration: 240, easing: Easing.out(Easing.cubic) };

// Draggable bottom sheet with two snap points — extracted from the canvasser
// map (a dedupe, not a copy; used there and on the admin Books map). Expanded =
// translateY 0; peek = translateY === snapDelta. The pan gesture is attached
// ONLY to the handle strip at the top, so it never fights the map's own
// pan/pinch gestures or a ScrollView inside the body. Tap the handle as a
// fallback for users who don't drag.
//
// snapDelta and sheetHeight are SHARED VALUES rather than constants because
// peek + expanded heights vary by mode/content — the owning screen sizes them
// (see the sizing effects in map.jsx / admin/books.jsx) and can derive other
// UI from the live sheet edge (e.g. the recenter button rides
// `sheetHeight - translateY`).
//
// The body's bottom pad comes from useBottomInset, not the raw safe-area inset, because this one
// component serves both callers: on the admin Books tab it has to clear the floating tab bar, and on
// the canvasser map (a Stack screen, no tabs) the hook returns exactly insets.bottom — so that screen
// keeps the padding it has always had.
export default function PullableSheet({ translateY, snapDelta, sheetHeight, children }) {
  const styles = useThemedStyles(makeStyles);
  const bottomInset = useBottomInset();
  const startY = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    height: sheetHeight.value,
    transform: [{ translateY: translateY.value }],
  }));

  const pan = Gesture.Pan()
    .onStart(() => {
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      const next = startY.value + e.translationY;
      translateY.value = Math.max(0, Math.min(snapDelta.value, next));
    })
    .onEnd((e) => {
      let target;
      if (e.velocityY < -500) target = 0;
      else if (e.velocityY > 500) target = snapDelta.value;
      else target = translateY.value < snapDelta.value / 2 ? 0 : snapDelta.value;
      translateY.value = withTiming(target, SHEET_TIMING);
    });

  function toggle() {
    const target = translateY.value > snapDelta.value / 2 ? 0 : snapDelta.value;
    translateY.value = withTiming(target, SHEET_TIMING);
  }

  return (
    <Animated.View style={[styles.sheetContainer, animatedStyle]}>
      <GestureDetector gesture={pan}>
        <Pressable onPress={toggle} style={styles.sheetHandleArea}>
          <View style={styles.sheetHandle} />
        </Pressable>
      </GestureDetector>
      <View style={[styles.sheetBody, { paddingBottom: spacing.xl + bottomInset }]}>
        {children}
      </View>
    </Animated.View>
  );
}

function makeStyles(t) {
  const { colors, shadow } = t;
  return StyleSheet.create({
    // Height is set via the animated style (varies by mode/content). translateY
    // pushes the sheet down so only the peek height is visible at rest.
    sheetContainer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      overflow: 'hidden',
      ...shadow.raised,
    },
    sheetHandleArea: {
      alignItems: 'center',
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
    },
    sheetHandle: {
      width: 44,
      height: 5,
      backgroundColor: colors.borderStrong,
      borderRadius: 3,
    },
    sheetBody: {
      flex: 1,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
    },
  });
}
