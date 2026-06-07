import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// Canvasser effort switcher for the Books picker. Book numbers restart per effort,
// so a canvasser on two efforts could see two "Book 6"s — this scopes the picker
// to one effort at a time. Presentational only; the parent owns the selection +
// persistence.
//
// Up to SEGMENT_MAX efforts render as a segmented control (all visible, one tap
// to switch — mirrors the appearance ThemeToggle). More than that falls back to a
// chip + dropdown so the row never wraps off-screen.
const SEGMENT_MAX = 3;

export default function EffortPicker({ efforts = [], value, onChange }) {
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const current = efforts.find((e) => String(e.id) === String(value)) || null;

  if (efforts.length <= 1) return null;

  if (efforts.length <= SEGMENT_MAX) {
    return (
      <View style={styles.segment}>
        {efforts.map((e) => {
          const active = String(e.id) === String(value);
          return (
            <Pressable
              key={e.id}
              onPress={() => {
                if (!active) onChange?.(e.id);
              }}
              style={[styles.option, active && styles.optionActive]}
            >
              <Text style={[styles.optionText, active && styles.optionTextActive]} numberOfLines={1}>
                {e.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View>
      <Pressable style={styles.chip} onPress={() => setOpen((v) => !v)}>
        <View style={styles.dot} />
        <Text style={styles.label}>Effort</Text>
        <Text style={styles.chipText} numberOfLines={1}>
          {current?.name || 'Pick an effort'}
        </Text>
        <Text style={styles.chevron}>{open ? '▴' : '▾'}</Text>
      </Pressable>

      {open && (
        <View style={styles.menu}>
          {efforts.map((e) => {
            const selected = String(e.id) === String(value);
            return (
              <Pressable
                key={e.id}
                onPress={() => {
                  setOpen(false);
                  if (!selected) onChange?.(e.id);
                }}
                style={[styles.item, selected && styles.itemActive]}
              >
                <Text style={[styles.itemText, selected && styles.itemTextActive]} numberOfLines={1}>
                  {e.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    // Segmented control — mirrors ThemeToggle so efforts read like a first-class
    // toggle rather than a buried dropdown.
    segment: {
      flexDirection: 'row',
      backgroundColor: t.colors.sunken,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.colors.border,
      padding: 3,
      gap: 3,
    },
    option: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.sm,
    },
    optionActive: { backgroundColor: t.colors.card, ...t.shadow.card },
    optionText: { fontSize: 13, fontWeight: '600', color: t.colors.textSecondary },
    optionTextActive: { color: t.colors.textPrimary },

    // Dropdown fallback (many efforts).
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
    label: { fontSize: 12, color: t.colors.textSecondary, marginRight: spacing.sm },
    chipText: { flex: 1, fontSize: 14, fontWeight: '600', color: t.colors.textPrimary },
    chevron: { fontSize: 12, color: t.colors.textSecondary, marginLeft: spacing.sm },
    menu: {
      backgroundColor: t.colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      paddingVertical: spacing.xs,
      marginTop: spacing.sm,
      ...t.shadow.raised,
    },
    item: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
    itemActive: { backgroundColor: t.colors.brandTint },
    itemText: { fontSize: 14, fontWeight: '600', color: t.colors.textPrimary },
    itemTextActive: { color: t.colors.brand },
  });
}
