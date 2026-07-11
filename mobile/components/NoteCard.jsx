import { View, Text, Pressable, StyleSheet } from 'react-native';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';
import { formatInTz } from '../lib/datetime';

// Door / Survey / Admin(VoterNote) — fixed colors matching the web NotesPage SOURCES.
const SOURCE_META = {
  door: { label: 'Door', color: '#3B82F6' },
  survey: { label: 'Survey', color: '#22C55E' },
  voter: { label: 'Admin', color: '#8B5CF6' },
};

const ACTION_LABEL = {
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  refused: 'Refused',
  restricted: 'Restricted',
  lit_dropped: 'Lit dropped',
  survey_submitted: 'Survey',
  note_added: 'Note',
};

// One note row for the Notes hub. Mirrors the web NoteCard: source badge + colored
// dot, door action label, "edited" tag, quoted body, and a meta line
// (author · time · voter · address). The whole card is tappable when it has a
// target — a voter note opens the voter profile; a household-only note opens the
// map focused on that door. Timestamps use the SERVER-resolved tz (data.timeZone),
// passed in as `tz`, so the clock matches web exactly.
export default function NoteCard({ note, tz, onOpenVoter, onOpenHousehold }) {
  const styles = useThemedStyles(makeStyles);
  const meta = SOURCE_META[note.source] || SOURCE_META.door;
  const when =
    formatInTz(note.timestamp, tz, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }, true) || '—';

  const target = note.voter
    ? { kind: 'voter', label: 'Open voter' }
    : note.household
      ? { kind: 'household', label: 'View on map' }
      : null;

  function onPress() {
    if (target?.kind === 'voter') onOpenVoter?.(note.voter.id);
    else if (target?.kind === 'household') onOpenHousehold?.(note.household.id);
  }

  const body = (
    <>
      <View style={styles.topRow}>
        <View style={styles.badgeWrap}>
          <View style={[styles.badge, { borderColor: meta.color }]}>
            <View style={[styles.dot, { backgroundColor: meta.color }]} />
            <Text style={styles.badgeText}>{meta.label}</Text>
          </View>
          {note.actionType && note.source === 'door' ? (
            <Text style={styles.action}>{ACTION_LABEL[note.actionType] || note.actionType}</Text>
          ) : null}
          {note.edited ? <Text style={styles.edited}>edited</Text> : null}
        </View>
        {target ? <Text style={styles.link}>{target.label} ›</Text> : null}
      </View>

      <Text style={styles.noteBody}>“{note.note}”</Text>

      <View style={styles.metaRow}>
        <Text style={styles.author}>{note.author?.name || 'Unknown'}</Text>
        <Text style={styles.metaSep}>·</Text>
        <Text style={styles.metaText}>{when}</Text>
        {note.voter?.name ? (
          <>
            <Text style={styles.metaSep}>·</Text>
            <Text style={styles.metaText}>{note.voter.name}</Text>
          </>
        ) : null}
        {note.household?.address ? (
          <>
            <Text style={styles.metaSep}>·</Text>
            <Text style={[styles.metaText, styles.addr]} numberOfLines={1}>
              {note.household.address}
            </Text>
          </>
        ) : null}
      </View>
    </>
  );

  if (!target) return <View style={styles.card}>{body}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      {body}
    </Pressable>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
      ...t.shadow.card,
    },
    topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
    badgeWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, flexShrink: 1 },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs + 2,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    dot: { width: 7, height: 7, borderRadius: 4 },
    badgeText: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
    action: { ...type.caption, color: colors.textMuted },
    edited: { ...type.caption, color: colors.textMuted, fontStyle: 'italic' },
    link: { color: colors.brand, fontWeight: '700', fontSize: 12, flexShrink: 0 },
    noteBody: { ...type.body, fontStyle: 'italic', marginTop: spacing.sm },
    metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: spacing.sm, gap: spacing.xs + 2 },
    author: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
    metaSep: { fontSize: 12, color: colors.textMuted },
    metaText: { fontSize: 12, color: colors.textSecondary },
    addr: { flexShrink: 1 },
  });
}
