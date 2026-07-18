import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfinitePaged } from '../../../lib/useInfinitePaged';
import { useRefresh } from '../../../lib/useRefresh';
import { formatRelative } from '../../../lib/dates';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

// The super-admin Emails screen — a metadata-only view of the transactional-email log
// (server/src/routes/superAdmin/emails.js). A drill-in off the More tab, not a bottom-tab of its
// own, so it registers with href:null in the super-admin _layout and pushes onto the tab stack.
// No live poll: the send log is history, refreshed on pull-to-refresh, never a Live pill.

const OUTCOMES = [
  { v: null, l: 'All' },
  { v: 'sent', l: 'Sent' },
  { v: 'failed', l: 'Failed' },
  { v: 'dormant', l: 'Dormant' },
];

// Raw kinds are snake/kebab machine ids (deletion_warning, org-invite); soften them for display
// while the chip's value stays the exact string the server filters on.
function humanizeKind(k) {
  return String(k || '').replace(/[_-]+/g, ' ');
}

const fullTime = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

// The right-side badge. deliveryStatus (Resend webhook) takes precedence when present; otherwise we
// fall back to the send-time outcome. The three delivery* fields may be absent on older rows — read
// them defensively.
function badgeFor(email) {
  const ds = email.deliveryStatus;
  if (ds === 'delivered') return { label: 'delivered', tone: 'success' };
  if (ds === 'bounced') return { label: 'bounced', tone: 'danger' };
  if (ds === 'complained') return { label: 'complained', tone: 'warn' };
  if (ds === 'delayed') return { label: 'delayed', tone: 'muted' };
  const o = email.outcome;
  if (o === 'sent') return { label: 'sent', tone: 'success' };
  if (o === 'failed') return { label: 'failed', tone: 'danger' };
  if (o === 'dormant') return { label: 'dormant', tone: 'muted' };
  return { label: o || 'unknown', tone: 'muted' };
}

export default function SuperAdminEmailsScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  const [outcome, setOutcome] = useState(null); // null = All
  const [kind, setKind] = useState(null); // null = All
  const [expandedId, setExpandedId] = useState(null);

  // Changing a filter changes the query key → useInfinitePaged starts a fresh query at skip 0.
  const emailsQ = useInfinitePaged(
    ['super-admin', 'emails', outcome || 'all', kind || 'all'],
    '/super-admin/emails',
    { outcome: outcome || undefined, kind: kind || undefined },
    { limit: 50, itemsKey: 'emails' }
  );

  const { refreshing, onRefresh } = useRefresh([emailsQ.refetch]);

  // kinds + last24h are computed server-side over ALL rows (never the current filter), so the first
  // page carries the complete, stable set — safe to read across pagination and filter changes.
  const firstPage = emailsQ.data?.pages?.[0];
  const kinds = firstPage?.kinds || [];
  const last24h = firstPage?.last24h || { sent: 0, failed: 0 };
  const failedTint = (last24h.failed || 0) > 0;

  const filtersActive = outcome !== null || kind !== null;
  const emails = emailsQ.items;

  const header = (
    <View>
      <View style={styles.statsRow}>
        <View style={styles.statChip}>
          <Text style={styles.statValue}>{(last24h.sent || 0).toLocaleString()}</Text>
          <Text style={styles.statLabel}>Sent 24h</Text>
        </View>
        <View style={[styles.statChip, failedTint && styles.statChipDanger]}>
          <Text style={[styles.statValue, failedTint && styles.statValueDanger]}>
            {(last24h.failed || 0).toLocaleString()}
          </Text>
          <Text style={[styles.statLabel, failedTint && styles.statLabelDanger]}>Failed 24h</Text>
        </View>
      </View>

      <Text style={styles.filterLabel}>Outcome</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {OUTCOMES.map((opt) => {
          const active = outcome === opt.v;
          return (
            <Pressable
              key={opt.l}
              onPress={() => setOutcome(opt.v)}
              style={[styles.filterPill, active && styles.filterPillActive]}
            >
              <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>{opt.l}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.filterLabel}>Type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        <Pressable
          onPress={() => setKind(null)}
          style={[styles.filterPill, kind === null && styles.filterPillActive]}
        >
          <Text style={[styles.filterPillText, kind === null && styles.filterPillTextActive]}>All</Text>
        </Pressable>
        {kinds.map((k) => {
          const active = kind === k;
          return (
            <Pressable
              key={k}
              onPress={() => setKind(k)}
              style={[styles.filterPill, active && styles.filterPillActive]}
            >
              <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                {humanizeKind(k)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ More</Text>
        </Pressable>
        <Text style={styles.topTitle}>Emails</Text>
        <View style={{ width: 80 }} />
      </View>

      <FlatList
        data={emails}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
        renderItem={({ item }) => (
          <EmailRow
            email={item}
            styles={styles}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId((id) => (id === item.id ? null : item.id))}
          />
        )}
        ListEmptyComponent={
          emailsQ.isLoading ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {filtersActive ? 'No emails match these filters.' : 'No emails logged yet.'}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          emailsQ.hasNextPage ? (
            <Pressable
              onPress={() => emailsQ.fetchNextPage()}
              disabled={emailsQ.isFetchingNextPage}
              style={styles.loadMore}
            >
              <Text style={styles.loadMoreText}>
                {emailsQ.isFetchingNextPage
                  ? 'Loading…'
                  : `Load more (${emails.length} of ${emailsQ.total})`}
              </Text>
            </Pressable>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function EmailRow({ email, styles, expanded, onToggle }) {
  const badge = badgeFor(email);
  const to = Array.isArray(email.to) ? email.to : [];
  const firstTo = to[0] || '—';
  const moreCount = to.length > 1 ? to.length - 1 : 0;
  const org = email.organization;

  return (
    <Pressable onPress={onToggle} style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}>
      <View style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowKindLine} numberOfLines={1}>
            {humanizeKind(email.kind)}
            <Text style={styles.rowTime}>{'  ·  ' + (formatRelative(email.sentAt, { never: '—' }))}</Text>
          </Text>
          <Text style={styles.rowTo} numberOfLines={1}>
            {firstTo}
            {moreCount > 0 ? <Text style={styles.rowMore}>{` +${moreCount} more`}</Text> : null}
          </Text>
          <Text style={styles.rowSubject} numberOfLines={1}>
            {email.subject || '(no subject)'}
          </Text>
        </View>
        <View style={styles.rowRight}>
          <View style={[styles.badge, styles[`badge_${badge.tone}`]]}>
            <Text style={[styles.badgeText, styles[`badgeText_${badge.tone}`]]}>{badge.label}</Text>
          </View>
          {email.keptForever ? (
            <View style={styles.keptPill}>
              <Text style={styles.keptPillText}>kept</Text>
            </View>
          ) : null}
        </View>
      </View>

      {expanded ? (
        <View style={styles.detail}>
          <DetailRow styles={styles} label="Recipients" value={to.length ? to.join(', ') : '—'} />
          <DetailRow styles={styles} label="Subject" value={email.subject || '(no subject)'} />
          <DetailRow
            styles={styles}
            label="Organization"
            value={org ? `${org.name}${org.deleted ? ' (deleted)' : ''}` : '—'}
          />
          <DetailRow styles={styles} label="Outcome" value={email.outcome || '—'} />
          {email.deliveryStatus ? (
            <DetailRow
              styles={styles}
              label="Delivery"
              value={
                email.deliveryStatus +
                (email.deliveryAt ? ` · ${fullTime(email.deliveryAt)}` : '')
              }
            />
          ) : null}
          {email.deliveryDetail ? (
            <DetailRow styles={styles} label="Delivery detail" value={email.deliveryDetail} />
          ) : null}
          {email.error ? <DetailRow styles={styles} label="Error" value={email.error} danger /> : null}
          <DetailRow styles={styles} label="Sent" value={fullTime(email.sentAt)} />
          {email.keptForever ? (
            <Text style={styles.keptNote}>Kept forever — deletion-warning evidence; never expires.</Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function DetailRow({ styles, label, value, danger }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, danger && styles.detailValueDanger]}>{value}</Text>
    </View>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    topBar: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    back: { color: colors.brand, fontWeight: '700', fontSize: 16, width: 80 },
    topTitle: { ...type.h3, flex: 1, textAlign: 'center' },

    statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    statChip: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      ...shadow.card,
    },
    statChipDanger: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
    statValue: { ...type.h2, fontSize: 22, fontVariant: ['tabular-nums'] },
    statValueDanger: { color: colors.danger },
    statLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginTop: 2,
    },
    statLabelDanger: { color: colors.danger },

    filterLabel: { ...type.micro, marginBottom: spacing.xs, marginLeft: 2 },
    filterRow: { flexDirection: 'row', gap: spacing.xs, paddingRight: spacing.lg, marginBottom: spacing.sm },
    filterPill: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    filterPillActive: { backgroundColor: colors.brandTint, borderColor: colors.brand },
    filterPillText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
    filterPillTextActive: { color: colors.brand },

    empty: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.xl,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    emptyText: { ...type.body, color: colors.textSecondary, textAlign: 'center' },

    row: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow.card,
    },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    rowKindLine: { ...type.bodyStrong, fontSize: 14, textTransform: 'capitalize' },
    rowTime: { fontSize: 11, fontWeight: '500', color: colors.textMuted, textTransform: 'none' },
    rowTo: { ...type.caption, fontSize: 12, marginTop: 2 },
    rowMore: { color: colors.textMuted },
    rowSubject: { ...type.caption, fontSize: 12, color: colors.textMuted, marginTop: 1 },

    rowRight: { alignItems: 'flex-end', gap: 4 },
    badge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    badgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
    badge_success: { backgroundColor: colors.successBg, borderColor: colors.successBorder },
    badgeText_success: { color: colors.success },
    badge_danger: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
    badgeText_danger: { color: colors.danger },
    badge_warn: { backgroundColor: colors.warnBg, borderColor: colors.warnBorder },
    badgeText_warn: { color: colors.warnFg },
    badge_muted: { backgroundColor: colors.bg, borderColor: colors.border },
    badgeText_muted: { color: colors.textSecondary },

    keptPill: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 1,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.warnBorder,
      backgroundColor: colors.warnBg,
    },
    keptPillText: { fontSize: 9, fontWeight: '800', color: colors.warnFg, textTransform: 'uppercase', letterSpacing: 0.4 },

    detail: {
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: spacing.xs,
    },
    detailRow: { flexDirection: 'row', gap: spacing.sm },
    detailLabel: {
      width: 96,
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    detailValue: { flex: 1, ...type.caption, fontSize: 13, color: colors.textPrimary },
    detailValueDanger: { color: colors.danger },
    keptNote: { ...type.caption, fontSize: 11, color: colors.warnFg, marginTop: spacing.xs, fontStyle: 'italic' },

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
  });
}
