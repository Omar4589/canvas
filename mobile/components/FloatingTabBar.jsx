import { useCallback, useContext, useEffect, useState } from 'react';
import { View, Text, Pressable, Keyboard, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, cancelAnimation } from 'react-native-reanimated';
import { BottomTabBarHeightCallbackContext } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import { SHEET_TIMING } from './PullableSheet';

// The bottom tab bar for both console navigators (admin + super-admin): a floating translucent pill
// rather than a docked bar, with the LABEL ON THE ACTIVE TAB ONLY — idle tabs are icon-only and the
// selected one expands to reveal its name.
//
// That label rule is a contrast constraint, not a preference. `glassBar` is `card` at 0.92, which
// over the worst backdrop composites to 4.06:1 against `textSecondary` — fine for the 24pt SVG
// icon strokes (non-text, 3:1 floor) and NOT enough for text (4.5:1). The one label that does show
// sits on a solid `brandTint` capsule, where `brandDark` is 5.91:1. Show all five labels and the
// translucency stops being defensible; the two decisions travel together.
//
// True backdrop blur is deliberately absent: expo-blur is a native module, so adding it moves the
// EAS fingerprint and costs a full set of builds + store review (mobile/README.md). The
// `tabBarBackground` slot below is the seam it drops into later, with no other change to this file.

// Idle icons are drawn at this size; the item is always 44×44 so the touch target can't shrink.
const ICON = 24;
const ITEM = 44;

export default function FloatingTabBar({ state, descriptors, navigation, insets }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const reportHeight = useContext(BottomTabBarHeightCallbackContext);

  // The 21 href:null admin screens are still real entries in state.routes (26 of them), and
  // expo-router hides them by stamping `tabBarItemStyle: { display: 'none' }` (its TabsClient does
  // the same for generated routes). It does NOT leave `href` on the options — that is destructured
  // away — so `display` is the only signal available. The stock bar renders all 26 and lets them
  // collapse to zero width; a custom bar has to filter. `index` is kept because state.index indexes
  // state.routes, NEVER this filtered array.
  const tabs = state.routes
    .map((route, index) => ({ route, index }))
    .filter(({ route }) => {
      const flat = StyleSheet.flatten(descriptors[route.key]?.options?.tabBarItemStyle);
      return flat?.display !== 'none';
    });

  // -1 whenever the focused route is one of the hidden screens (audit, notes, a canvasser
  // drill-in…), because those are filtered out above. Two consequences, both deliberate: the
  // highlight STAYS on the tab you came from (they are siblings in this one navigator, so there is
  // no "parent" tab to fall back to, and keeping the last one lit reads the way a pushed screen
  // does), and on a COLD deep-link straight into a hidden screen there is no prior — so slot 0
  // seeds it, which keeps the invariant that exactly one item is ever lit. Without that seed the
  // pill would render label-less and narrower on exactly that one path.
  const activeSlot = tabs.findIndex(({ index }) => index === state.index);

  // ONE transition value for the whole bar, driving a cross-fade between two slots. Each item's
  // weight is (slot === from ? 1 - p : 0) + (slot === to ? p : 0), so the weights always sum to
  // exactly 1 — the pill's total width therefore never changes (no layout pass, no reflowing
  // shadow), and jumping from tab 0 to tab 4 cross-fades those two DIRECTLY instead of smearing
  // every label in between, which is what animating the index itself would do.
  const p = useSharedValue(1);
  const [seg, setSeg] = useState(() => {
    const seed = activeSlot < 0 ? 0 : activeSlot;
    return { from: seed, to: seed };
  });

  useEffect(() => {
    if (activeSlot < 0) return;
    setSeg((s) => (s.to === activeSlot ? s : { from: s.to, to: activeSlot }));
  }, [activeSlot]);

  useEffect(() => {
    if (seg.from === seg.to) {
      p.value = 1;
      return;
    }
    p.value = 0;
    p.value = withTiming(1, SHEET_TIMING);
    // Rapid switching is safe by construction: `from` is the PREVIOUS TARGET, so a tap mid-flight
    // snaps the outgoing label in and cross-fades from there. It is structurally impossible to
    // strand two labels at partial opacity or to leave the pill mid-width.
    return () => cancelAnimation(p);
  }, [seg, p]);

  // A floating bar hovers OVER a raised keyboard, where the in-flow bar it replaces was pushed up
  // by the window. Hide it instead of repositioning, and report 0 so bottom-anchored elements
  // reclaim the space while it's gone.
  const [kbShown, setKbShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKbShown(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // The label slot is measured ONCE, from the longest label in this navigator, in a hidden layer.
  // Every item then reserves the same width, so the animation only ever changes which item is
  // spending it. It re-measures for free when the theme or the OS font scale changes, because the
  // hidden Text re-lays-out. Until measured it is 0 → icon-only, which is correct-looking.
  const [labelSlot, setLabelSlot] = useState(0);
  const longest = tabs.reduce((best, { route }) => {
    const label = labelFor(descriptors[route.key], route);
    return label.length > best.length ? label : best;
  }, '');

  const onWrapperLayout = useCallback(
    (e) => reportHeight?.(kbShown ? 0 : e.nativeEvent.layout.height),
    [reportHeight, kbShown]
  );

  useEffect(() => {
    if (kbShown) reportHeight?.(0);
  }, [kbShown, reportHeight]);

  if (kbShown) return null;

  // The focused route owns tabBarBackground — under a custom bar the navigator does NOT render it
  // for us, which is what keeps the future blur a one-line diff (see the header).
  const { tabBarBackground } = descriptors[state.routes[state.index].key]?.options || {};

  return (
    // box-none: the padding strip below the pill and the margins beside it must pass touches
    // through to whatever is underneath — on the Map tab that is the map.
    <View
      style={[styles.wrapper, { paddingBottom: insets.bottom + spacing.md }]}
      pointerEvents="box-none"
      onLayout={onWrapperLayout}
    >
      <View style={styles.pill}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {tabBarBackground?.()}
        </View>

        {/* Hidden measurer — same font as the real label, so the reserved width is exact. */}
        <Text
          style={[styles.label, styles.labelMeasure]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          onLayout={(e) => setLabelSlot(Math.ceil(e.nativeEvent.layout.width) + spacing.xs)}
        >
          {longest}
        </Text>

        {tabs.map(({ route, index }, slot) => (
          <TabItem
            key={route.key}
            slot={slot}
            seg={seg}
            p={p}
            labelSlot={labelSlot}
            label={labelFor(descriptors[route.key], route)}
            icon={descriptors[route.key]?.options?.tabBarIcon}
            a11yLabel={descriptors[route.key]?.options?.tabBarAccessibilityLabel}
            position={slot + 1}
            total={tabs.length}
            focused={index === state.index}
            colors={colors}
            styles={styles}
            onPress={() => {
              // The library's own sequence. Skipping the event breaks scroll-to-top listeners and
              // backBehavior="history".
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (index !== state.index && !event.defaultPrevented) {
                navigation.dispatch({ ...CommonActions.navigate(route), target: state.key });
              }
            }}
          />
        ))}
      </View>
    </View>
  );
}

const labelFor = (descriptor, route) => {
  const options = descriptor?.options || {};
  if (options.title != null) return options.title;
  if (typeof options.tabBarLabel === 'string') return options.tabBarLabel;
  return route.name;
};

function TabItem({
  slot,
  seg,
  p,
  labelSlot,
  label,
  icon,
  a11yLabel,
  position,
  total,
  focused,
  colors,
  styles,
  onPress,
}) {
  // The weight this slot currently owns, 0…1. Both styles read the same expression so the width and
  // the fade can never disagree.
  const weight = useAnimatedStyle(() => {
    const w = (seg.from === slot ? 1 - p.value : 0) + (seg.to === slot ? p.value : 0);
    return { width: ITEM + w * labelSlot };
  });
  const fade = useAnimatedStyle(() => ({
    opacity: (seg.from === slot ? 1 - p.value : 0) + (seg.to === slot ? p.value : 0),
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      // The filtered count, so a screen reader hears "3 of 5" rather than "3 of 26".
      accessibilityLabel={a11yLabel || `${label}, tab, ${position} of ${total}`}
    >
      <Animated.View style={[styles.item, weight]}>
        <Animated.View style={[styles.capsule, fade]} pointerEvents="none" />
        {icon?.({ color: focused ? colors.brandDark : colors.textSecondary, size: ICON, focused })}
        {/* Absolutely positioned, so it is OUT OF FLOW: the only thing in flow is the item's
            animated width, which is why nothing mounts, unmounts, or pushes. Truncation (not
            wrapping) is the deliberate failure mode at large font scales — a wrapped label in a
            44pt row would clip worse, and the five touch targets matter more than the word. */}
        <Animated.Text
          style={[styles.label, styles.labelActive, { left: ITEM - spacing.xs }, fade]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
        >
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

function makeStyles(t) {
  const { colors } = t;
  return StyleSheet.create({
    wrapper: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      // The bar is later in the tree than the scenes AND absolutely positioned, but an elevated
      // child inside a scene could still overdraw it on Android without this.
      zIndex: 1,
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: ITEM + 12,
      maxWidth: '100%',
      marginHorizontal: spacing.md,
      paddingHorizontal: 6,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.glassBar,
      // The stroke, not the shadow, is what separates this from the content in dark mode — the
      // shadow is effectively a no-op there by design (see theme.js).
      borderWidth: 1,
      borderColor: colors.border,
      ...t.shadow.raised,
      // Clips the capsule and, later, the BlurView, to the pill's radius.
      overflow: 'hidden',
    },
    item: {
      height: ITEM,
      minWidth: ITEM,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      borderRadius: radius.pill,
      overflow: 'hidden',
    },
    capsule: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.brandTint, borderRadius: radius.pill },
    label: {
      position: 'absolute',
      fontSize: 11,
      fontWeight: '600',
      // textSecondary, not textMuted: 11pt muted is 2.54:1 on card and worse over a translucent
      // fill. Same correction docs/THEMING.md mandates for type.micro everywhere else.
      color: colors.textSecondary,
    },
    // brandDark on brandTint is 5.91:1; raw brand would be 4.41:1 and fail.
    labelActive: { color: colors.brandDark },
    labelMeasure: { opacity: 0, left: 0, top: 0 },
  });
}
