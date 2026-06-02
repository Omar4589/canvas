import { View, Text, StyleSheet } from 'react-native';
import { timeAgo } from '../lib/datetime';
import { colors, radius, spacing, type, shadow } from '../lib/theme';

// One survey-response row: voter name + party + address + when, optionally the
// canvasser. `v` is a response entry from /survey-results or /voters-by-answer
// ({ responseId, submittedAt, voter, household, canvasser }).
export default function VoterRow({ v, showCanvasser = false }) {
  return (
    <View style={styles.row}>
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
        <Text style={styles.meta}>
          {timeAgo(v.submittedAt)}
          {showCanvasser && v.canvasser
            ? ` · ${v.canvasser.firstName || ''}${v.canvasser.lastName ? ' ' + v.canvasser.lastName[0] + '.' : ''}`
            : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xs,
  },
  name: { ...type.bodyStrong, fontSize: 14 },
  party: { color: colors.textSecondary, fontWeight: '400' },
  address: { ...type.caption, marginTop: 1 },
  meta: { ...type.caption, color: colors.textMuted, marginTop: 3 },
});
