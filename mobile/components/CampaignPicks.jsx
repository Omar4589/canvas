import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { historyLine, joinLine } from '../lib/addByEmail';
import { prePickFor } from '../lib/addToCampaigns';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

// The campaign list of the org view's add (AddPersonSheet) and a profile's Add to campaigns
// (AddToCampaignsSheet), docs/PROPOSAL_ADD_TO_CAMPAIGNS.md §D.1. One checkbox per active campaign and
// nothing checked to start — it never means "every campaign". A campaign they're already on shows checked
// and locked. Checking one opens ITS OWN coordinator (owner ruling 2026-10-30), pre-picked from their doors
// there when that crew can still lead, with the doors-from-before line and what joining does to those
// doors — the same sentences the campaign pill's add says (lib/addByEmail.js).
//
// `picks` is { [campaignId]: coordinatorId | '' } ('' = No coordinator); onChange gets the next one.
const CampaignPicks = ({
  campaigns = [], // [{ _id, name }] active campaigns, in the order to list them
  lockedIds = new Set(), // the campaigns they're already on
  histories = new Map(), // campaignId → { doors, sources } (their doors there from before)
  coordinators = [], // [{ id, name }] who can run a crew, the person themself left out (it arrives with the
  // lookup or history read the list is drawn from, so there is no loading state of its own)
  person = null, // { firstName } for the doors line
  picks,
  onChange,
  disabled = false,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // One coordinator list open at a time.
  const [openId, setOpenId] = useState(null);
  const choiceIds = coordinators.map((c) => c.id);

  const toggle = (id) => {
    if (disabled || lockedIds.has(id)) return;
    const next = { ...picks };
    if (has(next, id)) delete next[id];
    else next[id] = prePickFor(histories.get(id), choiceIds);
    if (openId === id) setOpenId(null);
    onChange(next);
  };
  const setCrew = (id, coordinatorId) => {
    onChange({ ...picks, [id]: coordinatorId });
    setOpenId(null);
  };

  if (!campaigns.length) return <Text style={styles.note}>No active campaigns yet.</Text>;

  return (
    <View>
      {campaigns.map((c) => {
        const id = String(c._id);
        const locked = lockedIds.has(id);
        const on = locked || has(picks, id);
        const history = histories.get(id) || null;
        const pick = picks?.[id] || '';
        // A pick is always one of `coordinators`: the pre-pick is chosen from them (prePickFor) and so is the list.
        const pickName = pick ? coordinators.find((x) => x.id === pick)?.name || null : null;
        const earlier = prePickFor(history, choiceIds);
        const doorsLine = historyLine(person, history);
        const movesLine = joinLine(history, pick || null, pickName);
        return (
          <View key={id}>
            <Pressable
              onPress={() => toggle(id)}
              disabled={disabled || locked}
              style={styles.row}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: disabled || locked }}
              accessibilityLabel={locked ? `${c.name}, already on it` : c.name}
            >
              <View style={[styles.check, on && styles.checkOn, locked && styles.checkLocked]}>
                {on ? <Text style={styles.checkMark}>✓</Text> : null}
              </View>
              <Text style={[styles.name, locked && styles.nameLocked]} numberOfLines={2}>
                {c.name}
              </Text>
              {locked ? <Text style={styles.onIt}>on it</Text> : null}
            </Pressable>
            {on && !locked ? (
              <View style={styles.detail}>
                {doorsLine ? <Text style={styles.note}>{doorsLine}</Text> : null}
                <Text style={styles.label}>Coordinator</Text>
                <Pressable style={styles.dropdown} onPress={() => setOpenId(openId === id ? null : id)} disabled={disabled}>
                  <Text style={styles.dropdownText} numberOfLines={1}>
                    {pickName ? `${pickName}${pick === earlier ? ' (their crew before)' : ''}` : 'No coordinator'}
                  </Text>
                  <Text style={{ color: colors.textMuted }}>{openId === id ? '▴' : '▾'}</Text>
                </Pressable>
                {openId === id ? (
                  <View style={styles.dropdownList}>
                    {[{ id: '', name: 'No coordinator' }, ...coordinators].map((x) => {
                      const chosen = pick === x.id;
                      return (
                        <Pressable
                          key={x.id || 'none'}
                          onPress={() => setCrew(id, x.id)}
                          style={[styles.dropdownItem, chosen && { backgroundColor: colors.brandTint }]}
                        >
                          <Text style={[styles.dropdownItemText, chosen && { color: colors.brand, fontWeight: '700' }]}>
                            {x.name}
                            {x.id && x.id === earlier ? ' (their crew before)' : ''}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {movesLine ? <Text style={styles.note}>{movesLine}</Text> : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
};

export default CampaignPicks;

const makeStyles = (t) => {
  const { colors, type } = t;
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    // The profile's checkbox (users/[id].jsx leadCheck), so the two lists look the same.
    check: {
      width: 20,
      height: 20,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: { backgroundColor: colors.brand, borderColor: colors.brand },
    checkLocked: { backgroundColor: colors.textMuted, borderColor: colors.textMuted },
    checkMark: { color: colors.textInverse, fontSize: 12, fontWeight: '800' },
    name: { ...type.body, fontSize: 14, flex: 1, color: colors.textPrimary },
    nameLocked: { color: colors.textSecondary },
    onIt: { ...type.caption, color: colors.textSecondary },
    detail: { paddingLeft: 28, paddingBottom: spacing.sm },
    label: { ...type.caption, color: colors.textMuted, fontWeight: '700', marginTop: spacing.sm, marginBottom: spacing.xs },
    note: { ...type.caption, color: colors.textSecondary, marginTop: spacing.xs },
    dropdown: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.bg,
    },
    dropdownText: { color: colors.textPrimary, fontWeight: '600', flexShrink: 1 },
    dropdownList: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      marginTop: spacing.xs,
      overflow: 'hidden',
    },
    dropdownItem: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    dropdownItemText: { color: colors.textPrimary },
  });
};
