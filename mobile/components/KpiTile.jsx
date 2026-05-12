import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing, type, shadow } from '../lib/theme';

// One KPI tile. value can be a string or number; sub is a small caption under
// the value; delta is an optional comparison ("+1.4 vs team avg") rendered
// below the sub. level controls the color of value: 'good' | 'caution' | 'low' | undefined.
export default function KpiTile({ label, value, sub, delta, level, compact = false }) {
  const valColor =
    level === 'good'
      ? colors.success
      : level === 'caution'
      ? '#92400E'
      : level === 'low'
      ? colors.danger
      : colors.textPrimary;
  const deltaPositive = delta && delta.value > 0;
  const deltaNeutral = delta && delta.value === 0;
  return (
    <View style={[styles.tile, compact && styles.tileCompact]}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.value, { color: valColor }, compact && styles.valueCompact]}>
        {value}
      </Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      {delta ? (
        <Text
          style={[
            styles.delta,
            deltaPositive && styles.deltaPositive,
            deltaNeutral && styles.deltaNeutral,
          ]}
        >
          {deltaPositive ? '▲' : deltaNeutral ? '·' : '▼'} {Math.abs(delta.value)}
          {delta.unit || ''} vs team
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    minHeight: 80,
  },
  tileCompact: {
    minHeight: 64,
    padding: spacing.sm,
  },
  label: {
    ...type.micro,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  value: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  valueCompact: {
    fontSize: 18,
  },
  sub: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  delta: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 4,
  },
  deltaPositive: { color: colors.success },
  deltaNeutral: { color: colors.textMuted },
});
