import { View, Text, StyleSheet } from 'react-native';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// One KPI tile. value can be a string or number; sub is a small caption under
// the value; delta is an optional comparison ("+1.4 vs team avg") rendered
// below the sub. level controls the color of value: 'good' | 'caution' | 'low' | undefined.
export default function KpiTile({ label, value, sub, delta, level, compact = false }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const valColor =
    level === 'good'
      ? colors.success
      : level === 'caution'
      ? colors.warnFg
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

function makeStyles(t) {
  return StyleSheet.create({
    tile: {
      backgroundColor: t.colors.card,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.shadow.card,
      minHeight: 80,
    },
    tileCompact: {
      minHeight: 64,
      padding: spacing.sm,
    },
    label: {
      ...t.type.micro,
      color: t.colors.textSecondary,
      marginBottom: 4,
    },
    value: {
      fontSize: 22,
      fontWeight: '700',
      color: t.colors.textPrimary,
    },
    valueCompact: {
      fontSize: 18,
    },
    sub: {
      ...t.type.caption,
      color: t.colors.textMuted,
      marginTop: 2,
    },
    delta: {
      fontSize: 11,
      fontWeight: '600',
      color: t.colors.textMuted,
      marginTop: 4,
    },
    deltaPositive: { color: t.colors.success },
    deltaNeutral: { color: t.colors.textMuted },
  });
}
