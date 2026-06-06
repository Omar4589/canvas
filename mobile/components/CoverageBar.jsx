import { View, Text, StyleSheet } from 'react-native';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// Segmented coverage bar mirroring the web CoverageBar: one proportional segment
// per household status, colored from colors.status. `compact` renders just the
// bar (per-campaign cards); full adds a wrapping legend (cumulative + detail).
const SEGMENTS = [
  { key: 'surveyed', label: 'Surveyed' },
  { key: 'lit_dropped', label: 'Lit dropped' },
  { key: 'not_home', label: 'Not home' },
  { key: 'wrong_address', label: 'Wrong addr' },
  { key: 'voted', label: 'Voted' },
  { key: 'unknocked', label: 'Unknocked' },
];

export default function CoverageBar({ canvass = {}, compact = false }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const total = SEGMENTS.reduce((s, seg) => s + (canvass[seg.key] || 0), 0);
  if (!total) {
    return compact ? <View style={styles.barEmpty} /> : <Text style={styles.empty}>No households yet.</Text>;
  }
  return (
    <View>
      <View style={[styles.bar, compact && styles.barCompact]}>
        {SEGMENTS.map((seg) => {
          const count = canvass[seg.key] || 0;
          if (!count) return null;
          return <View key={seg.key} style={{ flex: count, backgroundColor: colors.status[seg.key] }} />;
        })}
      </View>
      {!compact && (
        <View style={styles.legend}>
          {SEGMENTS.map((seg) => (
            <View key={seg.key} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: colors.status[seg.key] }]} />
              <Text style={styles.legendLabel}>{seg.label}</Text>
              <Text style={styles.legendCount}>{(canvass[seg.key] || 0).toLocaleString()}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      height: 10,
      borderRadius: radius.pill,
      overflow: 'hidden',
      backgroundColor: t.colors.border,
    },
    barCompact: { height: 8 },
    barEmpty: { height: 8, borderRadius: radius.pill, backgroundColor: t.colors.border },
    legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
    legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: spacing.md, marginTop: 2 },
    dot: { width: 8, height: 8, borderRadius: 4, marginRight: 4 },
    legendLabel: { ...t.type.caption, color: t.colors.textSecondary, marginRight: 4 },
    legendCount: { fontSize: 12, fontWeight: '700', color: t.colors.textPrimary, fontVariant: ['tabular-nums'] },
    empty: { ...t.type.caption, color: t.colors.textMuted },
  });
}
