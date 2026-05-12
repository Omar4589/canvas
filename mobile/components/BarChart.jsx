import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing, type } from '../lib/theme';

// Lightweight horizontal bar chart. No charting library.
// data: [{ label, value, secondaryValue?, color? }]
// max:  optional override (otherwise computed). When secondaryValue is set
//       (comparison mode), the secondary bar is rendered behind the primary
//       in a muted color.
// valueFormat: optional (v) => string for the trailing value text.
// height: bar pixel height.
export default function BarChart({
  data = [],
  max,
  valueFormat,
  secondaryLabel,
  height = 10,
}) {
  const fmt = valueFormat || ((v) => v?.toLocaleString?.() ?? String(v ?? 0));
  const computedMax =
    max ??
    Math.max(
      1,
      ...data.map((d) => Math.max(d.value || 0, d.secondaryValue || 0))
    );

  return (
    <View>
      {data.length === 0 ? (
        <Text style={styles.empty}>No data</Text>
      ) : (
        data.map((d, i) => {
          const pct = Math.round(((d.value || 0) / computedMax) * 100);
          const secPct =
            d.secondaryValue != null
              ? Math.round(((d.secondaryValue || 0) / computedMax) * 100)
              : null;
          return (
            <View key={i} style={styles.row}>
              <Text style={styles.label} numberOfLines={1}>
                {d.label}
              </Text>
              <View style={[styles.track, { height }]}>
                {secPct != null ? (
                  <View
                    style={[
                      styles.bar,
                      styles.secondary,
                      { width: `${secPct}%`, height },
                    ]}
                  />
                ) : null}
                <View
                  style={[
                    styles.bar,
                    {
                      width: `${pct}%`,
                      height,
                      backgroundColor: d.color || colors.brand,
                    },
                  ]}
                />
              </View>
              <Text style={styles.value}>{fmt(d.value || 0)}</Text>
            </View>
          );
        })
      )}
      {secondaryLabel && data.some((d) => d.secondaryValue != null) ? (
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: colors.brand }]} />
          <Text style={styles.legendText}>This canvasser</Text>
          <View style={styles.legendSpacer} />
          <View style={[styles.legendDot, styles.secondaryDot]} />
          <Text style={styles.legendText}>{secondaryLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: 3,
  },
  label: {
    ...type.caption,
    width: 84,
    color: colors.textSecondary,
  },
  track: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    overflow: 'hidden',
    position: 'relative',
  },
  bar: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: radius.sm,
  },
  secondary: {
    backgroundColor: colors.border,
  },
  value: {
    ...type.caption,
    width: 50,
    textAlign: 'right',
    color: colors.textPrimary,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  empty: {
    ...type.caption,
    fontStyle: 'italic',
    color: colors.textMuted,
    paddingVertical: spacing.sm,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  secondaryDot: { backgroundColor: colors.border },
  legendText: { ...type.caption, color: colors.textMuted },
  legendSpacer: { flex: 1 },
});
