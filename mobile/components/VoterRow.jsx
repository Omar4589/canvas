import { View, Text, StyleSheet } from 'react-native';
import { timeAgo } from '../lib/datetime';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// One survey-response row: voter name + party + address + when, optionally the
// canvasser. `v` is a response entry from /survey-results or /voters-by-answer
// ({ responseId, submittedAt, voter, household, canvasser }).
export default function VoterRow({ v, showCanvasser = false }) {
  const styles = useThemedStyles(makeStyles);
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

function makeStyles(t) {
  return StyleSheet.create({
    row: {
      backgroundColor: t.colors.card,
      borderRadius: radius.md,
      padding: spacing.sm + 2,
      borderWidth: 1,
      borderColor: t.colors.border,
      marginBottom: spacing.xs,
    },
    name: { ...t.type.bodyStrong, fontSize: 14 },
    party: { color: t.colors.textSecondary, fontWeight: '400' },
    address: { ...t.type.caption, marginTop: 1 },
    meta: { ...t.type.caption, color: t.colors.textMuted, marginTop: 3 },
  });
}
