import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { loadActiveCampaign, saveActiveCampaign, clearBootstrap } from '../lib/cache';
import { campaignShape, isArchivedCampaign, resolveChipSelection } from '../lib/campaignSelection';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// Active-campaign selector chip + dropdown. Used by the campaign-scoped admin
// tabs (Canvassers, Map) now that the admin home is an org overview. Self-loads
// the active campaign, defaults to the first active one, persists changes via
// saveActiveCampaign, and notifies the parent through onChange(campaign).
//
// ARCHIVED campaigns are listed and selectable — that is how a finished campaign's
// notes, maps and reports stay readable from a phone — but the AUTO-DEFAULT below
// stays active-only, so picking one is always a deliberate act. The rules live in
// lib/campaignSelection.js so they can be unit-tested; see the note there for what
// went wrong when one active-only list did all three jobs.
export default function CampaignChip({ value, onChange }) {
  const qc = useQueryClient();
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const [restored, setRestored] = useState(false);

  const campaignsQ = useQuery({ queryKey: ['admin', 'campaigns'], queryFn: () => api('/admin/campaigns') });
  const campaigns = campaignsQ.data?.campaigns || [];
  const activeCampaigns = campaigns.filter((c) => !isArchivedCampaign(c));
  const archivedCampaigns = campaigns.filter(isArchivedCampaign);
  const selectedArchived = !!value && archivedCampaigns.some((c) => String(c._id) === String(value.id));

  // Restore the persisted active campaign once on mount. When the list is already WARM (another
  // screen loaded it — More does, on the very path that reaches Notes) validate before seating,
  // so a screen never briefly holds a pick that is about to be corrected. Cold, we still hand it
  // over immediately — painting from disk is the point — and the effect below fixes it.
  useEffect(() => {
    loadActiveCampaign().then((c) => {
      const warm = qc.getQueryData(['admin', 'campaigns'])?.campaigns;
      const corrected = warm ? resolveChipSelection({ value: c || null, campaigns: warm }) : undefined;
      const seat = corrected === undefined ? c : corrected;
      if (seat) onChange?.(seat);
      setRestored(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once restore + the campaign list have settled, make sure the selection is a campaign this
  // viewer actually has: keep it (ACTIVE **or ARCHIVED**), else fall back to the first ACTIVE one,
  // else clear. The `restored` guard prevents racing the persisted value.
  useEffect(() => {
    if (!restored || !campaignsQ.data) return;
    const next = resolveChipSelection({ value, campaigns });
    if (next === undefined) return; // valid — keep it
    if (next === null && value === null) return; // already cleared; don't write on every render
    // Persist the correction, INCLUDING a null. Clearing only the screen used to leave a dead
    // entry on disk for every other reader to re-trip on, while useAdminCampaign cleared it —
    // the two disagreed about the same key.
    saveActiveCampaign(next);
    onChange?.(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, value, campaignsQ.data]);

  async function pick(c) {
    const next = campaignShape(c);
    await saveActiveCampaign(next);
    // Clear the canvasser door snapshot on every pick, archived included: this key is shared with
    // the field flow (books/map bootstrap off it), and leaving another campaign's doors on disk
    // only adds a second failure mode next to the archived bootstrap 404.
    await clearBootstrap();
    qc.removeQueries({ queryKey: ['bootstrap'] });
    onChange?.(next);
    setOpen(false);
  }

  const renderItem = (c) => {
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
  };

  return (
    <View>
      <Pressable
        style={styles.chip}
        onPress={() => setOpen((v) => !v)}
        accessibilityLabel={
          value?.name ? `${value.name}${selectedArchived ? ', archived, read-only' : ''}` : undefined
        }
      >
        {/* Muted dot when the pick is archived — de-emphasis, not a status claim. The words live
            in the screen's Archived — read-only banner; the chip text is single-line, so a
            " · Archived" suffix would truncate the campaign name instead. */}
        <View style={[styles.dot, selectedArchived && styles.dotArchived]} />
        <Text style={styles.chipText} numberOfLines={1}>
          {value?.name || (campaignsQ.isLoading ? 'Loading…' : 'Pick a campaign')}
        </Text>
        <Text style={styles.chevron}>{open ? '▴' : '▾'}</Text>
      </Pressable>

      {open && (
        // Capped + scrollable: the list now carries every archived campaign an org has ever
        // finished, and on the Map this menu floats over the map with nowhere to overflow to.
        <ScrollView style={styles.menu} contentContainerStyle={styles.menuContent}>
          {/* Only when the viewer manages NO campaigns at all. This used to read "No active
              campaigns yet." and was a terminal state: an org whose campaigns had all finished
              showed it with nothing to pick and no way forward. */}
          {campaigns.length === 0 && <Text style={styles.empty}>No campaigns yet.</Text>}
          {activeCampaigns.map(renderItem)}
          {archivedCampaigns.length > 0 && (
            <>
              <View style={styles.menuDivider} />
              <Text style={styles.menuSectionLabel}>Archived · read-only</Text>
              {archivedCampaigns.map(renderItem)}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.colors.card,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.shadow.card,
    },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.brand, marginRight: spacing.sm },
    dotArchived: { backgroundColor: t.colors.textMuted },
    chipText: { flex: 1, fontSize: 14, fontWeight: '600', color: t.colors.textPrimary },
    chevron: { fontSize: 12, color: t.colors.textSecondary, marginLeft: spacing.sm },
    menu: {
      backgroundColor: t.colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      marginTop: spacing.sm,
      maxHeight: 320,
      ...t.shadow.raised,
    },
    menuContent: { paddingVertical: spacing.xs },
    menuDivider: { height: 1, backgroundColor: t.colors.border, marginVertical: spacing.xs },
    menuSectionLabel: { ...t.type.micro, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
    item: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
    itemActive: { backgroundColor: t.colors.brandTint },
    itemText: { fontSize: 14, fontWeight: '600', color: t.colors.textPrimary },
    itemTextActive: { color: t.colors.brand },
    itemMeta: { ...t.type.caption, marginTop: 2 },
    empty: { ...t.type.caption, padding: spacing.md, textAlign: 'center' },
  });
}
