import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';

const ACTION_LABEL = {
  survey_submitted: 'Surveyed',
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  lit_dropped: 'Lit dropped',
};

const DOT_COLOR = {
  survey_submitted: colors.success,
  not_home: colors.brand,
  wrong_address: colors.danger,
  lit_dropped: '#7E22CE',
};

function formatRelative(d) {
  if (!d) return '';
  const date = new Date(d);
  const ms = Date.now() - date.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default function ActivityScreen() {
  const router = useRouter();

  const feedQ = useQuery({
    queryKey: ['super-admin', 'activity-feed', 50],
    queryFn: () => api('/super-admin/activity-feed?limit=50'),
    refetchInterval: 30_000,
  });

  const events = feedQ.data?.events || [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Control Room</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Live activity</Text>
        <View style={{ width: 80 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        {feedQ.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : events.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No activity yet across any org.</Text>
          </View>
        ) : (
          events.map((e) => (
            <View key={e.id} style={styles.row}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: DOT_COLOR[e.actionType] || colors.textMuted },
                ]}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.action}>
                  {ACTION_LABEL[e.actionType] || e.actionType}
                  {e.organization && (
                    <Text style={styles.org}>  · {e.organization.name}</Text>
                  )}
                </Text>
                <Text style={styles.sub} numberOfLines={2}>
                  {e.canvasser
                    ? `${e.canvasser.firstName} ${e.canvasser.lastName}`
                    : 'Unknown'}
                  {e.household?.addressLine1
                    ? ` · ${e.household.addressLine1}${
                        e.household.city ? `, ${e.household.city}` : ''
                      }`
                    : ''}
                  {e.campaign?.name ? ` · ${e.campaign.name}` : ''}
                </Text>
              </View>
              <Text style={styles.time}>{formatRelative(e.timestamp)}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { color: colors.brand, fontWeight: '700', fontSize: 14 },
  headerTitle: { ...type.h3 },

  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: { ...type.body, color: colors.textSecondary, textAlign: 'center' },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
    ...shadow.card,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  action: { ...type.bodyStrong, fontSize: 13 },
  org: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  sub: { ...type.caption, fontSize: 11, marginTop: 1 },
  time: { fontSize: 11, color: colors.textMuted },
});
