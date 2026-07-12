import { View, Text, StyleSheet } from 'react-native';
import { daysUntil, earlyVotingState } from '../lib/electionDates';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// A compact, timezone-correct "key dates" chip: an Election Day countdown pill, an early-voting
// state line, and (optionally, via `showNote`) the free-text dates note. One source of truth for
// the campaign picker, the canvasser Books header, and the mobile admin campaign detail. Renders
// `null` when a campaign has no key dates set. Dates are civil 'YYYY-MM-DD' strings interpreted in
// the campaign's own timeZone — see lib/electionDates.js (server stores strings on purpose so a
// Date never shifts a day across UTC midnight).
export default function ElectionCountdownChip({
  electionDay,
  earlyVotingStart,
  earlyVotingEnd,
  timeZone,
  datesNote,
  showNote = false,
  style,
}) {
  const styles = useThemedStyles(makeStyles);
  const edDays = daysUntil(electionDay, timeZone);
  const ev = earlyVotingState(earlyVotingStart, earlyVotingEnd, timeZone);
  const note = showNote && datesNote ? datesNote : null;
  if (edDays === null && !ev && !note) return null;

  return (
    <View style={style}>
      {edDays !== null &&
        (edDays < 0 ? (
          <Text style={styles.keyDateMuted}>Election Day passed</Text>
        ) : (
          <View style={styles.electionChip}>
            <Text style={styles.electionChipText}>
              {edDays === 0
                ? '🗳 Election Day today'
                : `🗳 ${edDays} day${edDays === 1 ? '' : 's'} to Election Day`}
            </Text>
          </View>
        ))}
      {ev && (
        <Text style={ev.state === 'closed' ? styles.keyDateMuted : styles.keyDateLine}>
          {ev.label}
        </Text>
      )}
      {note && (
        <Text style={styles.keyDateMuted} numberOfLines={2}>
          {note}
        </Text>
      )}
    </View>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    electionChip: {
      alignSelf: 'flex-start',
      backgroundColor: colors.brandTint,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.pill,
    },
    electionChipText: { fontSize: 12, fontWeight: '600', color: colors.brand },
    keyDateLine: { ...type.caption, fontSize: 12, marginTop: 2 },
    keyDateMuted: { ...type.caption, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  });
}
