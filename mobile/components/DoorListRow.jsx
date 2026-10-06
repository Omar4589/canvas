import { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import StatusPill from './StatusPill';
import { formatDistance } from '../lib/geo';
import { spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';

// One row of the canvasser door list. Either a single door (address + status +
// distance + inline quick-action), a building (address + "N units · M done"), a spot of
// different homes with no exact map spot ("N homes at one map spot", no distance — it
// would be measured to the shared spot), or a section header (lib/listEntries.js).
function DoorListRowBase({ item, campaignType, voters, onOpen, onQuick, onOpenBuilding }) {
  const { colors } = useTheme();

  if (item.kind === 'section') {
    return (
      <View style={[styles.section, { backgroundColor: colors.sunken }]}>
        <Text style={[styles.sectionText, { color: colors.textSecondary }]}>{item.title}</Text>
      </View>
    );
  }

  if (item.kind === 'homes') {
    const b = item.building;
    const dot = b.status === 'green' ? colors.success : b.status === 'yellow' ? colors.warnFg : colors.textMuted;
    return (
      <Pressable style={styles.row} onPress={() => onOpenBuilding(b)}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
            {b.total} homes at one map spot
          </Text>
          <View style={styles.metaRow}>
            <View style={[styles.dot, { backgroundColor: dot }]} />
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {b.total} homes · {b.done} done
            </Text>
          </View>
        </View>
        <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
      </Pressable>
    );
  }

  if (item.kind === 'building') {
    const b = item.building;
    const dot = b.status === 'green' ? colors.success : b.status === 'yellow' ? colors.warnFg : colors.textMuted;
    return (
      <Pressable style={styles.row} onPress={() => onOpenBuilding(b)}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>{b.addressLine1}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.dot, { backgroundColor: dot }]} />
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {b.total} units · {b.done} done
              {item.distanceM != null ? ` · ${formatDistance(item.distanceM)}` : ''}
            </Text>
          </View>
        </View>
        <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
      </Pressable>
    );
  }

  const h = item.household;
  const list = voters || [];
  const surveyed = list.filter((v) => v.surveyStatus === 'surveyed').length;
  const quickAction = campaignType === 'lit_drop' ? 'lit_dropped' : 'not_home';
  const quickLabel = campaignType === 'lit_drop' ? 'Lit dropped' : 'Not home';

  return (
    <View style={styles.row}>
      <Pressable style={{ flex: 1 }} onPress={() => onOpen(h._id)}>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {h.addressLine1}{h.addressLine2 ? ` ${h.addressLine2}` : ''}
        </Text>
        <View style={styles.metaRow}>
          <StatusPill status={h.status || 'unknocked'} compact />
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {campaignType === 'survey' && list.length ? ` · ${list.length} voter${list.length === 1 ? '' : 's'} · ${surveyed} surveyed` : ''}
            {item.distanceM != null ? ` · ${formatDistance(item.distanceM)}` : ''}
            {item.noSpot ? ' · No exact map spot' : ''}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={() => onQuick(h._id, quickAction)}
        hitSlop={4}
        style={({ pressed }) => [
          styles.quickBtn,
          { backgroundColor: colors.status[quickAction] || colors.textMuted, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={styles.quickText}>{quickLabel}</Text>
      </Pressable>
    </View>
  );
}

export default memo(DoorListRowBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { fontSize: 15, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' },
  meta: { fontSize: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  chevron: { fontSize: 22, fontWeight: '300' },
  section: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  sectionText: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  quickBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  quickText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});
