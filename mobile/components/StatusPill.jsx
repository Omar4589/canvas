import { View, Text, StyleSheet } from 'react-native';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';

// Small colored status pill (dot + label). Extracted from map.jsx so the door
// list, the map sheet, and the household detail all render it identically.
export default function StatusPill({ status, compact = false }) {
  const { colors } = useTheme();
  const dotColor = colors.status[status] || colors.textMuted;
  const isDone = status === 'surveyed' || status === 'lit_dropped';
  const isRefused = status === 'refused';
  const isMiss = status === 'not_home' || status === 'wrong_address';
  const bg = isDone ? colors.successBg : isRefused ? colors.warnBg : isMiss ? colors.dangerBg : colors.bg;
  const border = isDone
    ? colors.successBorder
    : isRefused
    ? colors.warnBorder
    : isMiss
    ? colors.dangerBorder
    : colors.border;
  const textColor = isDone
    ? colors.success
    : isRefused
    ? colors.warnFg
    : isMiss
    ? colors.danger
    : colors.textSecondary;
  return (
    <View style={[styles.pill, { backgroundColor: bg, borderColor: border }, compact && styles.compact]}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={[styles.text, { color: textColor }]}>{colors.statusLabels[status] || 'Unknown'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  compact: { paddingHorizontal: 8, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  text: { fontSize: 11, fontWeight: '700' },
});
