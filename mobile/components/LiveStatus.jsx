import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, StyleSheet } from 'react-native';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// Compact "live refresh" status pill + toggle (RN port of the web console's
// LiveStatus). Owns its own 1s ticker so only this chip re-renders each second,
// keeping the "updated Xs ago" label fresh without churning the host screen.
function agoLabel(updatedAt, now) {
  if (!updatedAt) return 'just now';
  const s = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
}

export default function LiveStatus({ live, onToggle, isFetching, updatedAt, onRefresh }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [now, setNow] = useState(() => Date.now());
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  useEffect(() => {
    if (!live || isFetching) {
      pulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [live, isFetching, pulse]);

  let label;
  if (live && isFetching) label = 'Updating…';
  else if (live) label = `Live · ${agoLabel(updatedAt, now)}`;
  else label = 'Paused';

  return (
    <View style={styles.wrap}>
      <Pressable onPress={onToggle} style={styles.pill} hitSlop={6}>
        <Animated.View
          style={[
            styles.dot,
            { backgroundColor: live ? colors.success : colors.textMuted, opacity: live ? pulse : 1 },
          ]}
        />
        <Text style={styles.label}>{label}</Text>
      </Pressable>
      {!live ? (
        <Pressable onPress={onRefresh} hitSlop={6}>
          <Text style={styles.refresh}>Refresh</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    label: { fontSize: 12, fontWeight: '600', color: t.colors.textMuted, fontVariant: ['tabular-nums'] },
    refresh: { fontSize: 12, fontWeight: '700', color: t.colors.brand },
  });
}
