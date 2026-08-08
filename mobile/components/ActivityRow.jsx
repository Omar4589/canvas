import { View, Text, Pressable, StyleSheet } from 'react-native';
import { radius, spacing, ACTION_LABELS } from '../lib/theme';
import { FAR_WARN_M } from '../lib/flags';
import { formatDistance } from '../lib/geo';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import PinIcon from './PinIcon';

// Map CanvassActivity actionType → PinIcon status key (the status palette is
// keyed on Household status, which differs slightly from action enums).
const ACTION_TO_PIN = {
  survey_submitted: 'surveyed',
  not_home: 'not_home',
  wrong_address: 'wrong_address',
  refused: 'refused',
  lit_dropped: 'lit_dropped',
  restricted: 'restricted',
  no_soliciting: 'no_soliciting',
  note_added: 'unknocked',
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
  const styles = useThemedStyles(makeStyles);
  const a = activity;
  // FAR_WARN_M (75), not a local 50. The server raised it so a rooftop-pin-vs-sidewalk gap stopped
  // reading as suspicious, and lib/flags.js mirrors that — but this component kept its own copy, so
  // every 50-75m knock rendered a red 'flagged' badge that the GPS audit screen and the server's own
  // flaggedOnly filter both consider clean.
  const flagged =
    a.wasOfflineSubmission ||
    (a.distanceFromHouseMeters != null && a.distanceFromHouseMeters > FAR_WARN_M);
  // Server-annotated: the pin was corrected after this knock and the entry sits beside the
  // corrected spot. Badge SWAP, not hide — the raw distance is still a fact (its red meta text
  // stays); only the verdict changes. Absent field (older server/payload) → false → identical
  // to today.
  const forgiven = !!a.pinForgiven;
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
          {ACTION_LABELS[a.actionType] || a.actionType}
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
                a.distanceFromHouseMeters > FAR_WARN_M && styles.metaWarn,
              ]}
            >
              📍 {formatDistance(a.distanceFromHouseMeters)}
            </Text>
          ) : null}
          {a.wasOfflineSubmission ? (
            <View style={styles.offlineBadge}>
              <Text style={styles.offlineText}>offline</Text>
            </View>
          ) : null}
          {forgiven ? (
            <View style={styles.forgivenBadge}>
              <Text style={styles.forgivenText}>forgiven</Text>
            </View>
          ) : flagged ? (
            <View style={styles.flagBadge}>
              <Text style={styles.flagText}>flagged</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Wrapper>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: t.colors.card,
      borderRadius: radius.lg,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.shadow.card,
      gap: spacing.sm,
    },
    pinCol: {
      alignItems: 'center',
      width: 40,
    },
    time: {
      ...t.type.caption,
      color: t.colors.textMuted,
      marginTop: 2,
      fontVariant: ['tabular-nums'],
    },
    action: { ...t.type.bodyStrong },
    party: { color: t.colors.textSecondary, fontWeight: '400' },
    address: { ...t.type.caption, marginTop: 1 },
    note: {
      ...t.type.caption,
      color: t.colors.textSecondary,
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
    meta: { ...t.type.caption, color: t.colors.textMuted },
    metaWarn: { color: t.colors.danger, fontWeight: '600' },
    offlineBadge: {
      backgroundColor: t.colors.warnBg,
      paddingHorizontal: spacing.xs,
      paddingVertical: 1,
      borderRadius: radius.sm,
    },
    offlineText: {
      color: t.colors.warnFg,
      fontSize: 10,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    flagBadge: {
      backgroundColor: t.colors.dangerBg,
      paddingHorizontal: spacing.xs,
      paddingVertical: 1,
      borderRadius: radius.sm,
    },
    flagText: {
      color: t.colors.danger,
      fontSize: 10,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    forgivenBadge: {
      backgroundColor: t.colors.successBg,
      paddingHorizontal: spacing.xs,
      paddingVertical: 1,
      borderRadius: radius.sm,
    },
    forgivenText: {
      color: t.colors.success,
      fontSize: 10,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
  });
}
