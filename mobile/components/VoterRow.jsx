import { View, Text, StyleSheet, Pressable } from 'react-native';
import { timeAgo } from '../lib/datetime';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// One survey-response row: voter name + party + address + when, optionally the
// canvasser. `v` is a response entry from /survey-results or /voters-by-answer
// ({ responseId, submittedAt, voter, household, canvasser }). Pass `onPress` to
// make the row tappable (adds a chevron); `exactTime` (a pre-formatted string,
// campaign-tz) for a right-side timestamp; `showBadges` for the note/offline
// tags (v.note / v.wasOfflineSubmission). All opt-in, so existing usages render
// exactly as before.
export default function VoterRow({ v, showCanvasser = false, onPress = null, exactTime = null, showBadges = false }) {
  const styles = useThemedStyles(makeStyles);
  const inner = (
    <>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>
          {v.voter?.fullName || 'Unknown voter'}
          {v.voter?.party ? <Text style={styles.party}> · {v.voter.party}</Text> : null}
        </Text>
        {v.household ? (
          <Text style={styles.address} numberOfLines={1}>
            {v.household.addressLine1}
            {v.household.city ? `, ${v.household.city}` : ''}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <Text style={styles.meta}>
            {timeAgo(v.submittedAt)}
            {showCanvasser && v.canvasser
              ? ` · ${v.canvasser.firstName || ''}${v.canvasser.lastName ? ' ' + v.canvasser.lastName[0] + '.' : ''}`
              : ''}
          </Text>
          {showBadges && v.wasOfflineSubmission ? <Text style={styles.offlineTag}>offline</Text> : null}
          {showBadges && v.note ? <Text style={styles.noteTag}>note</Text> : null}
        </View>
      </View>
      {exactTime ? (
        <Text style={styles.time} numberOfLines={2}>
          {exactTime}
        </Text>
      ) : null}
      {onPress ? <Text style={styles.chevron}>›</Text> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{inner}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}>
      {inner}
    </Pressable>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    row: {
      backgroundColor: t.colors.card,
      borderRadius: radius.md,
      padding: spacing.sm + 2,
      borderWidth: 1,
      borderColor: t.colors.border,
      marginBottom: spacing.xs,
      flexDirection: 'row',
      alignItems: 'center',
    },
    chevron: { fontSize: 18, color: t.colors.textMuted, marginLeft: spacing.sm },
    name: { ...t.type.bodyStrong, fontSize: 14 },
    party: { color: t.colors.textSecondary, fontWeight: '400' },
    address: { ...t.type.caption, marginTop: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
    meta: { ...t.type.caption, color: t.colors.textMuted },
    time: {
      ...t.type.caption,
      fontSize: 11,
      color: t.colors.textMuted,
      textAlign: 'right',
      maxWidth: 96,
      marginLeft: spacing.sm,
    },
    offlineTag: {
      fontSize: 10,
      fontWeight: '700',
      color: t.colors.warnFg,
      backgroundColor: t.colors.warnBg,
      borderRadius: radius.pill,
      paddingHorizontal: 6,
      paddingVertical: 1,
      overflow: 'hidden',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    noteTag: {
      fontSize: 10,
      fontWeight: '700',
      color: t.colors.textSecondary,
      backgroundColor: t.colors.sunken,
      borderRadius: radius.pill,
      paddingHorizontal: 6,
      paddingVertical: 1,
      overflow: 'hidden',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
  });
}
