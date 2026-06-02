import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing, type } from '../lib/theme';

// Segmented coverage bar mirroring the web CoverageBar: one proportional segment
// per household status, colored from colors.status. `compact` renders just the
// bar (per-campaign cards); full adds a wrapping legend (cumulative + detail).
const SEGMENTS = [
  { key: 'surveyed', label: 'Surveyed' },
  { key: 'lit_dropped', label: 'Lit dropped' },
  { key: 'not_home', label: 'Not home' },
  { key: 'wrong_address', label: 'Wrong addr' },
  { key: 'unknocked', label: 'Unknocked' },
];

export default function CoverageBar({ canvass = {}, compact = false }) {
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

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  barCompact: { height: 8 },
  barEmpty: { height: 8, borderRadius: radius.pill, backgroundColor: colors.border },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: spacing.md, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 4 },
  legendLabel: { ...type.caption, color: colors.textSecondary, marginRight: 4 },
  legendCount: { fontSize: 12, fontWeight: '700', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  empty: { ...type.caption, color: colors.textMuted },
});
