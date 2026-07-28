import { useEffect } from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing } from '../lib/theme';
import { makeRateColors, RATE_TIERS } from '../lib/rates';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import { SHEET_TIMING } from './PullableSheet';

// "How these are counted" — the explanation behind an InsetGroup. A bottom sheet rather than a
// centered card because this gets read between doors with one hand, and rather than a pushed
// screen because the numbers it explains stay visible behind the scrim: you read
// "986 ÷ 4,136" while the 986 and the 4,136 are still on the page.
//
// `items` are the metrics currently ON SCREEN, so the sheet is anchored to live values instead
// of being an abstract glossary: [{ key, label, value, unit, help, math, level }]. `help` is
// metricHelp copy passed through verbatim — this component never restates a definition, so
// there's nothing here to drift from the web's copy.
export default function MetricSheet({ visible, onClose, title, items = [] }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Android's system nav bar overlaps bottom sheets without this inset (item D8). It only
  // reports a real number because this Modal is NOT statusBarTranslucent — see below.
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(0);

  // Reopening after a drag must start from the top, not from wherever it was let go.
  useEffect(() => {
    if (visible) translateY.value = 0;
  }, [visible, translateY]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  // Drag-to-dismiss, on the grabber only so it never fights the body ScrollView.
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 80 || e.velocityY > 600) runOnJS(onClose)();
      else translateY.value = withTiming(0, SHEET_TIMING);
    });

  const rc = makeRateColors(colors);
  const tiered = items.find((it) => it.level);

  return (
    // NO statusBarTranslucent. It strips `fitsSystemWindows` off the modal's content frame
    // (ReactModalHostView.kt sets it only when the prop is false), so the dialog window goes
    // edge-to-edge over the Android nav bar — while useSafeAreaInsets() still reports the
    // ACTIVITY window's insets (SafeAreaUtils measures against view.rootView) and returns 0.
    // Result: the sheet renders under the virtual buttons. No other Modal in this app sets it.
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* A Modal is its own native window, OUTSIDE the app's root GestureHandlerRootView —
          without this wrapper the grabber's pan gesture silently never fires (RNGH's own
          RNGestureHandlerRootView names this case). It is ALSO the node that gives the sheet a
          DEFINITE height, which is what lets the sheet's `maxHeight: '90%'` resolve at all. */}
      <GestureHandlerRootView style={styles.root}>
        {/* SIBLING, not a wrapper. Wrapping meant an unstyled stop-propagation Pressable sat
            between the definite-height root and the sheet — and Yoga only redistributes space
            inside a container with a definite main size, so the ScrollView's built-in
            flexShrink:1 was inert and the sheet grew past the window instead of the body
            scrolling. A sibling sheet can never bubble into the backdrop, so nothing needs to
            swallow taps. */}
        <Pressable style={styles.backdrop} onPress={onClose} accessible={false} />

        <Animated.View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }, sheetStyle]}
          accessibilityViewIsModal
        >
          <GestureDetector gesture={pan}>
            <View style={styles.grabberArea}>
              <View style={styles.grabber} accessibilityElementsHidden importantForAccessibility="no" />
            </View>
          </GestureDetector>

          {/* No maxHeight here. RN puts flexGrow:1 + flexShrink:1 on every ScrollView
              (ScrollView.js `baseVertical`), so inside a sheet with a definite cap it shrinks
              to exactly what the grabber and the Done button leave over. Capping the SCROLLER
              instead was the bug: the cap excluded the chrome, so the sheet was always taller
              than the number it was capped to. */}
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.md }}>
            {title ? <Text style={styles.title}>{title}</Text> : null}

            {items.map((it) => (
              <View key={it.key} style={styles.item}>
                <Text style={styles.itemLabel}>
                  {it.label} · {it.value}
                  {it.unit ? ` ${it.unit}` : ''}
                </Text>
                <Text style={styles.itemText}>{it.help}</Text>
                {it.math ? (
                  <View style={styles.well}>
                    <Text style={styles.wellText}>{it.math}</Text>
                  </View>
                ) : null}
              </View>
            ))}

            {/* The tier ladder answers the two questions a colored number always raises:
                why is it this color, and what would change it. Rows come from RATE_TIERS,
                the same constant that decides the color — they cannot disagree. */}
            {tiered ? (
              <View style={styles.item}>
                <Text style={styles.itemLabel}>What the colors mean</Text>
                {RATE_TIERS.map((t) => {
                  const on = t.level === tiered.level;
                  return (
                    <View key={t.level} style={styles.tierRow}>
                      <View style={[styles.dot, { backgroundColor: rc[t.level].fg }]} />
                      <Text style={[styles.tierWord, on && styles.tierWordOn]}>{t.word}</Text>
                      <Text style={styles.tierRange}>{t.range}</Text>
                      {on ? <Text style={styles.tierNow}>now</Text> : null}
                    </View>
                  );
                })}
              </View>
            ) : null}
          </ScrollView>

          <Pressable style={styles.btn} onPress={onClose} accessibilityRole="button">
            <Text style={styles.btnText}>Done</Text>
          </Pressable>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    // The root owns the definite height and the bottom anchoring; the backdrop just fills it.
    root: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.backdrop },
    sheet: {
      // The bound belongs on the SHEET, not the scroller — it has to include the grabber, the
      // Done button and the bottom inset. A percentage only resolves because this is a DIRECT
      // child of `root`, which has a definite height; put anything auto-height in between and
      // it silently becomes no cap at all.
      maxHeight: '90%',
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: spacing.lg,
    },
    grabberArea: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.md },
    grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },

    title: { ...type.h3, marginBottom: spacing.md },
    item: { marginBottom: spacing.lg },
    itemLabel: { ...type.bodyStrong, marginBottom: 2 },
    itemText: { ...type.caption },

    // `sunken` on `card` is only 1.10:1 in light and 1.04:1 in DARK — as a bare fill this well
    // would be invisible in dark mode. The hairline is what makes it read as a distinct block,
    // the same reason an InsetGroup keeps its border (see docs/THEMING.md).
    well: {
      marginTop: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.sunken,
      borderWidth: 1,
      borderColor: colors.border,
    },
    wellText: { ...type.caption, color: colors.textPrimary, fontVariant: ['tabular-nums'] },

    tierRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    dot: { width: 8, height: 8, borderRadius: 4 },
    tierWord: { ...type.caption, color: colors.textPrimary, minWidth: 72 },
    tierWordOn: { fontWeight: '700' },
    tierRange: { ...type.caption, flex: 1, fontVariant: ['tabular-nums'] },
    tierNow: { ...type.caption, color: colors.brand, fontWeight: '700' },

    btn: {
      backgroundColor: colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      minHeight: 44, // the touch-target floor; padding alone left it at ~38pt
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
    },
    btnText: { ...type.bodyStrong, color: colors.textInverse, fontWeight: '700' },
  });
}
