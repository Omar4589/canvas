import { View, Text, StyleSheet } from 'react-native';
import { daysUntil, earlyVotingState, formatDay, hasKeyDates } from '../lib/electionDates';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// A compact, timezone-correct "key dates" block: the Election Day pill (which always carries the
// ACTUAL date, not just a countdown), the early-voting window (which always carries BOTH bounds),
// and optionally the free-text note. One source of truth for the campaign picker, the canvasser
// Books header, and the mobile admin campaign detail. Renders `null` when a campaign has no key
// dates — callers that draw chrome around it gate on the same hasKeyDates(), so the two can never
// disagree. Dates are civil 'YYYY-MM-DD' strings read in the campaign's timeZone (the server
// stores strings on purpose so a Date never shifts a day across UTC midnight).
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
  if (!hasKeyDates({ electionDay, earlyVotingStart, earlyVotingEnd, datesNote, showNote }))
    return null;

  const edDays = daysUntil(electionDay, timeZone);
  const ev = earlyVotingState(earlyVotingStart, earlyVotingEnd, timeZone);
  const note = showNote && datesNote ? datesNote : null;
  const passed = edDays !== null && edDays < 0;
  // A finished campaign would otherwise float two dead lines ("Election Day was…" + "Early
  // voting ended…") over the map forever. Once the election is behind us the early-voting line
  // has nothing left to say.
  const showEv = ev && !(passed && ev.state === 'closed');
  // ONE urgency treatment: brand red = "this is happening now". Amber is the Refused
  // disposition's color in this app; two adjacent alarm colors would encode nothing.
  const edUrgent = edDays === 0 || edDays === 1;

  return (
    <View style={style}>
      {edDays !== null &&
        (passed ? (
          <Text style={styles.keyDateMuted}>
            Election Day was {formatDay(electionDay, { weekday: 'short' })}
          </Text>
        ) : (
          <View style={styles.dateRow}>
            <View style={styles.electionChip}>
              <Text style={styles.electionChipText}>
                🗳 Election Day · {formatDay(electionDay, { weekday: 'short' })}
              </Text>
            </View>
            <Text style={[styles.countdown, edUrgent && styles.urgent]}>
              {edDays === 0 ? 'today' : edDays === 1 ? 'tomorrow' : `in ${edDays} days`}
            </Text>
          </View>
        ))}
      {showEv && (
        <Text
          style={
            ev.urgent
              ? styles.keyDateUrgent
              : ev.state === 'closed'
              ? styles.keyDateMuted
              : styles.keyDateLine
          }
        >
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
    // The countdown is a SIBLING Text, never text inside the pill: a pill child that overruns
    // its parent wraps *inside the lozenge*, and a two-line pill reads as broken. flexWrap lets
    // the countdown drop to its own line in the narrow campaign-picker card instead.
    dateRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
    electionChip: {
      alignSelf: 'flex-start',
      backgroundColor: colors.brandTint,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.pill,
    },
    electionChipText: { fontSize: 12, fontWeight: '600', color: colors.brand },
    countdown: { fontSize: 12, color: colors.textSecondary },
    urgent: { color: colors.brand, fontWeight: '700' },
    keyDateLine: { ...type.caption, fontSize: 12, marginTop: 2 },
    keyDateUrgent: {
      ...type.caption,
      fontSize: 12,
      marginTop: 2,
      color: colors.brand,
      fontWeight: '700',
    },
    keyDateMuted: { ...type.caption, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  });
}
