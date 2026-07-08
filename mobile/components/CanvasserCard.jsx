import { View, Text, Pressable, StyleSheet } from 'react-native';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import { rateFromPct, makeRateColors } from '../lib/rates';
import { formatRange } from '../lib/datetime';

// Shared per-canvasser card for the campaign home and the Timeline, so both read the
// same: coordinator, doors, surveys/lit (by campaign type), connection %, contact %,
// doors/hr, and the first→last shift. `row` is normalized to:
//   { userId, firstName, lastName, email, isActive, coordinatorName, inOverlap?,
//     dayKnocks, daySurveys, dayLit, connectionRate, contactRate, doorsPerHour,
//     hoursOnDoors, firstActivityAt, lastActivityAt }
function initials(name) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function CanvasserCard({
  row,
  tz,
  rank,
  litMode = false,
  onPress,
  // Compare-mode selection (Timeline): render a checkbox in place of the rank and
  // treat the whole card as a toggle. Defaults keep the card unchanged elsewhere.
  selectable = false,
  selected = false,
  onToggle,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const rc = makeRateColors(colors);

  const name = `${row.firstName || ''} ${row.lastName || ''}`.trim() || row.email;
  const lvl = rateFromPct(row.connectionRate)?.level;
  const shift = formatRange(row.firstActivityAt, row.lastActivityAt, tz);
  const primaryVal = litMode ? row.dayLit || 0 : row.daySurveys || 0;
  const primaryLabel = litMode ? 'lit' : 'surveys';
  const handlePress = selectable ? onToggle : onPress;

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.row,
        selectable && selected && styles.rowChecked,
        pressed && handlePress && { opacity: 0.7 },
      ]}
    >
      {selectable ? (
        <View style={[styles.check, selected && styles.checkOn]}>
          {selected ? <Text style={styles.checkMark}>✓</Text> : null}
        </View>
      ) : rank != null ? (
        <Text style={styles.rank}>{rank}</Text>
      ) : null}
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(name) || '?'}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>
          {name}
          {row.inOverlap ? ' ⚠' : ''}
          {!row.isActive && <Text style={styles.inactive}> · inactive</Text>}
        </Text>
        <Text style={styles.meta}>{row.coordinatorName || '—'}</Text>
        <View style={styles.statsLine}>
          <Text style={styles.statBold}>{row.dayKnocks || 0}</Text>
          <Text style={styles.stat}> doors · </Text>
          <Text style={styles.statBold}>{primaryVal}</Text>
          <Text style={styles.stat}> {primaryLabel} · </Text>
          <Text style={[styles.statBold, { color: lvl ? rc[lvl].fg : colors.textMuted }]}>
            {row.connectionRate}%
          </Text>
          <Text style={styles.stat}> conn</Text>
        </View>
        <Text style={styles.metaSmall}>
          {row.contactRate}% contact
          {row.doorsPerHour > 0 ? ` · ${row.hoursOnDoors}h · ${row.doorsPerHour.toFixed(1)}/hr` : ''}
        </Text>
        {shift ? <Text style={styles.shift}>🕘 {shift}</Text> : null}
      </View>
      {!selectable && onPress ? <Text style={styles.chev}>›</Text> : null}
    </Pressable>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow.card,
      gap: spacing.sm,
    },
    rowChecked: { borderColor: colors.brand, backgroundColor: colors.brandTint },
    rank: { width: 22, fontSize: 13, fontWeight: '800', color: colors.brand, textAlign: 'center' },
    check: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: { backgroundColor: colors.brand, borderColor: colors.brand },
    checkMark: { color: colors.textInverse, fontWeight: '800', fontSize: 14 },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.brandTint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: colors.brand, fontWeight: '800', fontSize: 14 },
    name: { ...type.bodyStrong, fontSize: 14 },
    inactive: { ...type.caption, color: colors.textMuted, fontWeight: '400' },
    meta: { ...type.caption, marginTop: 1 },
    metaSmall: { fontSize: 11, color: colors.textMuted, fontVariant: ['tabular-nums'], marginTop: 2 },
    statsLine: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
    stat: { fontSize: 12, color: colors.textSecondary },
    statBold: { fontSize: 12, color: colors.textPrimary, fontWeight: '700' },
    shift: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontVariant: ['tabular-nums'] },
    chev: { fontSize: 22, color: colors.textMuted, fontWeight: '300' },
  });
}
