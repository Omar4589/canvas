import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { formatInTz } from '../lib/datetime';
import { REVIEW_STATUS_META, reviewToneColors, REASON_BY_KEY, reasonDetailText } from '../lib/flags';
import FlagReviewControl from './FlagReviewControl';
import { spacing, radius } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// RN mirror of client/src/components/FlaggedEntryList.jsx (one card). Collapsed by default;
// tapping reveals the review control. Reason badges + status pill are always visible.
function houseLine(h) {
  if (!h) return '—';
  const l2 = h.addressLine2 ? ` ${h.addressLine2}` : '';
  return `${h.addressLine1 || ''}${l2}, ${h.city || ''} ${h.state || ''}`.trim().replace(/^,|,$/g, '') || '—';
}

export default function FlaggedEntryCard({ entry, tz, onReviewed, onViewOnMap, defaultExpanded = false }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const status = entry.review?.status || 'open';
  const meta = REVIEW_STATUS_META[status] || REVIEW_STATUS_META.open;
  const tone = reviewToneColors(colors, meta.tone);
  const when = formatInTz(
    entry.timestamp,
    tz,
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
    true
  );
  const reasons = entry.reasons || [];

  return (
    <View style={styles.card}>
      <Pressable onPress={() => setExpanded((v) => !v)} style={styles.header} hitSlop={4}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>
            {entry.canvasser?.name || 'Canvasser'}
          </Text>
          <Text style={styles.addr} numberOfLines={1}>
            {houseLine(entry.household)}
          </Text>
          <Text style={styles.when}>{when || '—'}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
          <Text style={[styles.statusPillText, { color: tone.fg }]}>{meta.label}</Text>
        </View>
      </Pressable>

      <View style={styles.badges}>
        {reasons.map((r, i) => {
          const rm = REASON_BY_KEY[r.type];
          return (
            <View key={`${r.type}-${i}`} style={styles.badge}>
              <View style={[styles.badgeDot, { backgroundColor: rm?.color || '#888' }]} />
              <Text style={styles.badgeText}>{rm?.short || r.type}</Text>
              <Text style={styles.badgeDetail} numberOfLines={1}>
                {reasonDetailText(r)}
              </Text>
            </View>
          );
        })}
      </View>

      {expanded ? (
        <View style={styles.expanded}>
          <FlagReviewControl entry={entry} tz={tz} onReviewed={onReviewed} />
          {onViewOnMap ? (
            <Pressable onPress={() => onViewOnMap(entry)} style={styles.mapLink} hitSlop={6}>
              <Text style={styles.mapLinkText}>View on map ›</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow.card,
    },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    name: { ...type.bodyStrong, fontSize: 14 },
    addr: { ...type.caption, marginTop: 1 },
    when: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontVariant: ['tabular-nums'] },
    statusPill: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
    statusPillText: { fontSize: 11, fontWeight: '700' },
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.sunken,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    badgeDot: { width: 8, height: 8, borderRadius: 4 },
    badgeText: { fontSize: 11, fontWeight: '700', color: colors.textPrimary },
    badgeDetail: { fontSize: 11, color: colors.textMuted },
    expanded: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
    mapLink: { marginTop: spacing.sm, alignSelf: 'flex-start' },
    mapLinkText: { fontSize: 12, fontWeight: '700', color: colors.brand },
  });
}
