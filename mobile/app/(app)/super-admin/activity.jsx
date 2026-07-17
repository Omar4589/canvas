import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useFocusedPoll } from '../../../lib/useFocusedPoll';
import { api } from '../../../lib/api';
import { useRefresh } from '../../../lib/useRefresh';
import LiveStatus from '../../../components/LiveStatus';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

const ACTION_LABEL = {
  survey_submitted: 'Surveyed',
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  refused: 'Refused',
  restricted: 'Restricted',
  lit_dropped: 'Lit dropped',
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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const DOT_COLOR = {
    survey_submitted: colors.success,
    not_home: colors.brand,
    wrong_address: colors.danger,
    refused: colors.status.refused,
    restricted: colors.status.restricted,
    lit_dropped: colors.accentPurple,
  };

  const [live, setLive] = useState(true);
  const feedQ = useQuery({
    queryKey: ['super-admin', 'activity-feed', 50],
    queryFn: () => api('/super-admin/activity-feed?limit=50'),
    refetchInterval: live ? 30_000 : false,
    // Pause the poll (and refresh on return) while a pushed screen covers this one.
    ...useFocusedPoll(),
  });

  const { refreshing, onRefresh } = useRefresh([feedQ.refetch]);

  // "Load older" pages accumulate below the live window (`before` mirrors the feed's `since`).
  // The live page keeps polling; older pages are static history, deduped where the windows meet.
  const [older, setOlder] = useState([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const liveEvents = feedQ.data?.events || [];
  const liveIds = new Set(liveEvents.map((e) => e.id));
  const events = [...liveEvents, ...older.filter((e) => !liveIds.has(e.id))];

  async function loadOlder() {
    const oldest = events[events.length - 1];
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const res = await api(
        `/super-admin/activity-feed?limit=50&before=${encodeURIComponent(oldest.timestamp)}`
      );
      const page = res?.events || [];
      if (page.length === 0) setExhausted(true);
      setOlder((cur) => {
        const have = new Set([...cur.map((e) => e.id), ...liveIds]);
        return [...cur, ...page.filter((e) => !have.has(e.id))];
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Control Room</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Live activity</Text>
        <View style={{ width: 80 }} />
      </View>
      <View style={styles.liveRow}>
        <LiveStatus
          live={live}
          onToggle={() => setLive((v) => !v)}
          isFetching={feedQ.isFetching}
          updatedAt={feedQ.dataUpdatedAt}
          onRefresh={() => feedQ.refetch()}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
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
                  {/* City/state only — street addresses left this feed on purpose (server route). */}
                  {e.household?.city
                    ? ` · ${e.household.city}${e.household.state ? `, ${e.household.state}` : ''}`
                    : ''}
                  {e.campaign?.name ? ` · ${e.campaign.name}` : ''}
                </Text>
              </View>
              <Text style={styles.time}>{formatRelative(e.timestamp)}</Text>
            </View>
          ))
        )}
        {events.length > 0 && (
          exhausted ? (
            <Text style={styles.endText}>Beginning of the feed.</Text>
          ) : (
            <Pressable onPress={loadOlder} disabled={loadingOlder} style={styles.loadMore}>
              <Text style={styles.loadMoreText}>{loadingOlder ? 'Loading…' : 'Load older'}</Text>
            </Pressable>
          )
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
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
  liveRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },

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

  loadMore: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    marginTop: spacing.xs,
  },
  loadMoreText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  endText: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
  });
}
