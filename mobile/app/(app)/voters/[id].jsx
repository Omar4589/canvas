import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { formatExact, timeAgo } from '../../../lib/datetime';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';

function answerText(a) {
  if (a == null || a === '') return '—';
  return Array.isArray(a) ? a.join(', ') : String(a);
}

function Card({ title, children }) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export default function VoterProfile() {
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams();
  const voterId = Array.isArray(id) ? id[0] : id;
  const [campaign, setCampaign] = useState(undefined);
  const [note, setNote] = useState('');
  const cId = campaign?.id;

  useEffect(() => {
    loadActiveCampaign().then((c) => setCampaign(c || null));
  }, []);

  const key = ['mobile', 'voter', voterId, cId];
  const profileQ = useQuery({
    queryKey: key,
    queryFn: () => api(`/mobile/voters/${voterId}?campaignId=${cId}`),
    enabled: !!cId && !!voterId,
  });

  const addNote = useMutation({
    mutationFn: (body) =>
      api(`/mobile/voters/${voterId}/notes`, { method: 'POST', body: { campaignId: cId, body } }),
    onSuccess: () => {
      setNote('');
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const p = profileQ.data;
  const v = p?.voter;
  const h = p?.household;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Voters</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{v?.fullName || 'Voter'}</Text>
        <View style={{ width: 64 }} />
      </View>

      {profileQ.isLoading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
      ) : profileQ.error ? (
        <Text style={styles.muted}>{profileQ.error.message}</Text>
      ) : !p ? null : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
          <View style={styles.badges}>
            {v.party ? <Text style={styles.badge}>{v.party}</Text> : null}
            <Text style={[styles.badge, v.surveyStatus === 'surveyed' && styles.badgeGreen]}>
              {v.surveyStatus === 'surveyed' ? 'Surveyed' : 'Not surveyed'}
            </Text>
            {p.voted?.isVoted ? <Text style={[styles.badge, styles.badgeTeal]}>✓ Voted</Text> : null}
          </View>

          <Card title="Details">
            <Detail label="Voter ID" value={v.stateVoterId} />
            <Detail label="Phone" value={v.phone || v.cellPhone} />
            <Detail label="Gender" value={v.gender} />
            <Detail label="Precinct" value={v.precinct} />
            <Detail label="Registration" value={v.registrationStatus} />
          </Card>

          {h ? (
            <Card title="Household">
              <Text style={styles.addr}>
                {h.addressLine1}{h.addressLine2 ? `, ${h.addressLine2}` : ''}
              </Text>
              <Text style={styles.addrSub}>{h.city}, {h.state} {h.zipCode}</Text>
              {h.campaign ? <Text style={styles.addrSub}>Campaign: {h.campaign.name}</Text> : null}
              {h.members?.length ? (
                <View style={{ marginTop: spacing.sm }}>
                  {h.members.map((m) => (
                    <Pressable key={m.id} onPress={() => router.push(`/(app)/voters/${m.id}`)}>
                      <Text style={styles.memberLink}>
                        {m.fullName}
                        <Text style={styles.addrSub}>{m.voted ? ' · voted' : ''}</Text>
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </Card>
          ) : null}

          <Card title={`Survey responses (${p.surveys.length})`}>
            {p.surveys.length === 0 ? (
              <Text style={styles.muted}>None.</Text>
            ) : (
              p.surveys.map((s) => (
                <View key={s.id} style={styles.surveyBlock}>
                  <Text style={styles.surveyHead}>{s.templateName || 'Survey'} · {timeAgo(s.submittedAt)}</Text>
                  {s.answers.map((a) => (
                    <Text key={a.questionKey} style={styles.answer}>
                      <Text style={styles.answerQ}>{a.questionLabel}: </Text>{answerText(a.answer)}
                    </Text>
                  ))}
                  {s.note ? <Text style={styles.surveyNote}>📝 {s.note}</Text> : null}
                </View>
              ))
            )}
          </Card>

          <Card title="Notes">
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Add a note about this voter…"
              placeholderTextColor={colors.textMuted}
              multiline
              style={styles.noteInput}
            />
            <Pressable
              onPress={() => note.trim() && addNote.mutate(note.trim())}
              disabled={!note.trim() || addNote.isPending}
              style={[styles.addBtn, (!note.trim() || addNote.isPending) && { opacity: 0.5 }]}
            >
              <Text style={styles.addBtnText}>{addNote.isPending ? 'Adding…' : 'Add note'}</Text>
            </Pressable>

            {p.notes.admin.map((n) => (
              <View key={n.id} style={styles.noteItem}>
                <Text style={styles.noteBody}>{n.body}</Text>
                <Text style={styles.noteMeta}>{n.author ? n.author.name : 'Unknown'} · {formatExact(n.createdAt, campaign?.timeZone)}</Text>
              </View>
            ))}
            {p.notes.field.map((n) => (
              <View key={`${n.source}-${n.id}`} style={[styles.noteItem, { borderColor: colors.border }]}>
                <Text style={styles.noteBody}>{n.note}</Text>
                <Text style={styles.noteMeta}>
                  {n.source === 'survey' ? 'Survey' : n.actionType} · {n.by ? n.by.name : 'Unknown'} · {timeAgo(n.timestamp)}
                </Text>
              </View>
            ))}
          </Card>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Detail({ label, value }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value || '—'}</Text>
    </View>
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
  back: { color: colors.brand, fontWeight: '700', fontSize: 16, width: 64 },
  headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },
  muted: { ...type.caption, textAlign: 'center', marginTop: spacing.lg },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  badge: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    fontSize: 12,
    color: colors.textSecondary,
    overflow: 'hidden',
  },
  badgeGreen: { backgroundColor: '#DCFCE7', color: '#15803D', borderColor: '#DCFCE7' },
  badgeTeal: { backgroundColor: '#CCFBF1', color: '#0F766E', borderColor: '#CCFBF1' },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  cardTitle: { ...type.h3, fontSize: 15, marginBottom: spacing.sm },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  detailLabel: { ...type.caption, color: colors.textSecondary },
  detailValue: { fontSize: 14, color: colors.textPrimary, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  addr: { ...type.bodyStrong, fontSize: 14 },
  addrSub: { ...type.caption, marginTop: 2 },
  memberLink: { color: colors.brand, fontWeight: '600', fontSize: 14, marginTop: 2 },
  surveyBlock: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm },
  surveyHead: { ...type.caption, color: colors.textMuted, marginBottom: 4 },
  answer: { fontSize: 13, color: colors.textPrimary, marginBottom: 2 },
  answerQ: { color: colors.textSecondary },
  surveyNote: { ...type.caption, marginTop: 4, color: colors.textSecondary },
  noteInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    minHeight: 60,
    fontSize: 14,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  addBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  addBtnText: { color: colors.textInverse, fontWeight: '700', fontSize: 14 },
  noteItem: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
  noteBody: { fontSize: 14, color: colors.textPrimary },
  noteMeta: { ...type.caption, color: colors.textMuted, marginTop: 3 },
});
