import { useEffect } from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
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
  // Android's system nav bar overlaps bottom sheets without this inset (item D8).
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
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
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      {/* A Modal is its own native window, OUTSIDE the app's root GestureHandlerRootView —
          without this wrapper the grabber's pan gesture silently never fires. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose} accessible={false}>
          {/* Swallow taps inside the sheet so they don't dismiss it. */}
          <Pressable onPress={() => {}} accessible={false}>
            <Animated.View
              style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }, sheetStyle]}
              accessibilityViewIsModal
            >
              <GestureDetector gesture={pan}>
                <View style={styles.grabberArea}>
                  <View style={styles.grabber} accessibilityElementsHidden importantForAccessibility="no" />
                </View>
              </GestureDetector>

              <ScrollView
                style={{ maxHeight: height * 0.7 }}
                contentContainerStyle={{ paddingBottom: spacing.md }}
              >
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
          </Pressable>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: spacing.lg,
    },
    grabberArea: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.md },
    grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },

    title: { ...type.h3, marginBottom: spacing.md },
    item: { marginBottom: spacing.lg },
    itemLabel: { ...type.bodyStrong, fontSize: 14, marginBottom: 2 },
    itemText: { ...type.caption },

    well: {
      marginTop: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.sunken,
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
      paddingVertical: spacing.sm + 2,
      alignItems: 'center',
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
    },
    btnText: { color: colors.textInverse, fontWeight: '700', fontSize: 15 },
  });
}
