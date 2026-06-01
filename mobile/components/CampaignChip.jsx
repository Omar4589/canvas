import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { loadActiveCampaign, saveActiveCampaign, clearBootstrap } from '../lib/cache';
import { colors, radius, spacing, type, shadow } from '../lib/theme';

// Active-campaign selector chip + dropdown. Used by the campaign-scoped admin
// tabs (Canvassers, Map) now that the admin home is an org overview. Self-loads
// the active campaign, defaults to the first active one, persists changes via
// saveActiveCampaign, and notifies the parent through onChange(campaign).
export default function CampaignChip({ value, onChange }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [restored, setRestored] = useState(false);

  const campaignsQ = useQuery({ queryKey: ['admin', 'campaigns'], queryFn: () => api('/admin/campaigns') });
  const activeCampaigns = (campaignsQ.data?.campaigns || []).filter((c) => c.isActive);

  // Restore the persisted active campaign once on mount.
  useEffect(() => {
    loadActiveCampaign().then((c) => {
      if (c) onChange?.(c);
      setRestored(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once restore + the campaign list have settled, make sure the selection is a
  // valid ACTIVE campaign: default to the first active one (or signal none) when
  // nothing is selected OR the persisted pick was archived/removed. The `restored`
  // guard prevents racing the persisted value.
  useEffect(() => {
    if (!restored || !campaignsQ.data) return;
    const valid = value && activeCampaigns.some((c) => String(c._id) === String(value.id));
    if (valid) return;
    if (activeCampaigns.length) {
      const c = activeCampaigns[0];
      const next = { id: String(c._id), name: c.name, type: c.type, state: c.state };
      saveActiveCampaign(next);
      onChange?.(next);
    } else if (value !== null) {
      onChange?.(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, value, campaignsQ.data]);

  async function pick(c) {
    const next = { id: String(c._id), name: c.name, type: c.type, state: c.state };
    await saveActiveCampaign(next);
    await clearBootstrap();
    qc.removeQueries({ queryKey: ['bootstrap'] });
    onChange?.(next);
    setOpen(false);
  }

  return (
    <View>
      <Pressable style={styles.chip} onPress={() => setOpen((v) => !v)}>
        <View style={styles.dot} />
        <Text style={styles.chipText} numberOfLines={1}>
          {value?.name || (campaignsQ.isLoading ? 'Loading…' : 'Pick a campaign')}
        </Text>
        <Text style={styles.chevron}>{open ? '▴' : '▾'}</Text>
      </Pressable>

      {open && (
        <View style={styles.menu}>
          {activeCampaigns.length === 0 && (
            <Text style={styles.empty}>No active campaigns yet.</Text>
          )}
          {activeCampaigns.map((c) => {
            const selected = String(c._id) === value?.id;
            return (
              <Pressable
                key={c._id}
                onPress={() => pick(c)}
                style={[styles.item, selected && styles.itemActive]}
              >
                <Text style={[styles.itemText, selected && styles.itemTextActive]}>{c.name}</Text>
                <Text style={styles.itemMeta}>
                  {c.state} · {c.type === 'lit_drop' ? 'Lit drop' : 'Survey'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand, marginRight: spacing.sm },
  chipText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  chevron: { fontSize: 12, color: colors.textSecondary, marginLeft: spacing.sm },
  menu: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xs,
    marginTop: spacing.sm,
    ...shadow.raised,
  },
  item: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  itemActive: { backgroundColor: colors.brandTint },
  itemText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  itemTextActive: { color: colors.brand },
  itemMeta: { ...type.caption, marginTop: 2 },
  empty: { ...type.caption, padding: spacing.md, textAlign: 'center' },
});
