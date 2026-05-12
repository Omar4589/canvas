import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, radius, spacing, type, shadow } from '../lib/theme';
import PinIcon from './PinIcon';

// Map CanvassActivity actionType → PinIcon status key (the status palette is
// keyed on Household status, which differs slightly from action enums).
const ACTION_TO_PIN = {
  survey_submitted: 'surveyed',
  not_home: 'not_home',
  wrong_address: 'wrong_address',
  lit_dropped: 'lit_dropped',
  note_added: 'unknocked',
};

const ACTION_LABEL = {
  survey_submitted: 'Surveyed',
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  lit_dropped: 'Lit dropped',
  note_added: 'Note added',
};

function timeOnly(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// activity: {
//   actionType, timestamp, household, voter, note,
//   distanceFromHouseMeters, wasOfflineSubmission
// }
// onPress optional → navigate to activity detail
export default function ActivityRow({ activity, onPress, showDate = false }) {
  const a = activity;
  const flagged =
    a.wasOfflineSubmission ||
    (a.distanceFromHouseMeters != null && a.distanceFromHouseMeters > 50);
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress}
      style={({ pressed }) => [styles.row, onPress && pressed && { opacity: 0.7 }]}
    >
      <View style={styles.pinCol}>
        <PinIcon status={ACTION_TO_PIN[a.actionType] || 'unknocked'} size={22} />
        <Text style={styles.time}>{timeOnly(a.timestamp)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.action}>
          {ACTION_LABEL[a.actionType] || a.actionType}
          {a.voter?.fullName ? ` · ${a.voter.fullName}` : ''}
          {a.voter?.party ? <Text style={styles.party}> ({a.voter.party})</Text> : null}
        </Text>
        {a.household ? (
          <Text style={styles.address} numberOfLines={2}>
            {a.household.addressLine1}
            {a.household.city ? `, ${a.household.city}` : ''}
            {a.household.state ? ` ${a.household.state}` : ''}
          </Text>
        ) : null}
        {a.note ? (
          <Text style={styles.note} numberOfLines={2}>
            “{a.note}”
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          {showDate && a.timestamp ? (
            <Text style={styles.meta}>
              {new Date(a.timestamp).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </Text>
          ) : null}
          {a.distanceFromHouseMeters != null ? (
            <Text
              style={[
                styles.meta,
                a.distanceFromHouseMeters > 50 && styles.metaWarn,
              ]}
            >
              📍 {Math.round(a.distanceFromHouseMeters)}m
            </Text>
          ) : null}
          {a.wasOfflineSubmission ? (
            <View style={styles.offlineBadge}>
              <Text style={styles.offlineText}>offline</Text>
            </View>
          ) : null}
          {flagged ? (
            <View style={styles.flagBadge}>
              <Text style={styles.flagText}>flagged</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    gap: spacing.sm,
  },
  pinCol: {
    alignItems: 'center',
    width: 40,
  },
  time: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  action: { ...type.bodyStrong },
  party: { color: colors.textSecondary, fontWeight: '400' },
  address: { ...type.caption, marginTop: 1 },
  note: {
    ...type.caption,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  meta: { ...type.caption, color: colors.textMuted },
  metaWarn: { color: colors.danger, fontWeight: '600' },
  offlineBadge: {
    backgroundColor: colors.warnBg,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  offlineText: {
    color: '#92400E',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  flagBadge: {
    backgroundColor: colors.dangerBg,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  flagText: {
    color: colors.danger,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
