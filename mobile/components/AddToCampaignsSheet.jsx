import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import CampaignPicks from './CampaignPicks';
import {
  onCampaignIds,
  historyByCampaign,
  pickCount,
  picksBody,
  submitLabel,
  coordinatorNames,
  profileDoneView,
} from '../lib/addToCampaigns';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// A profile's Add to campaigns (docs/PROPOSAL_ADD_TO_CAMPAIGNS.md §D.4): the active campaigns they aren't on
// yet, a coordinator for each one checked, and their doors there from before — read fresh from the server
// when the sheet opens (GET /admin/memberships/:userId/campaign-history) — then one add for all of them
// (POST …/campaigns) and one email. The profile's campaign list used to be read-only because an add there
// would have joined them with no crew choice and moved a returning person's doors unseen; both are on the
// screen now.
const AddToCampaignsSheet = ({
  userId,
  person, // { firstName, lastName }
  campaigns = [], // the organization's ACTIVE campaigns
  onClose,
  onAdded, // (answer) => void — refresh the caller's lists
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [picks, setPicks] = useState({});
  const [result, setResult] = useState(null);

  const historyQ = useQuery({
    queryKey: ['admin', 'membership-campaign-history', userId],
    queryFn: ({ signal }) => api(`/admin/memberships/${userId}/campaign-history`, { signal }),
    enabled: !!userId,
  });
  const addMut = useMutation({
    mutationFn: (body) => api(`/admin/memberships/${userId}/campaigns`, { method: 'POST', body }),
  });
  const busy = addMut.isPending;

  const rows = historyQ.data?.campaigns;
  const locked = useMemo(() => onCampaignIds(rows), [rows]);
  const histories = useMemo(() => historyByCampaign(rows), [rows]);
  const offered = useMemo(() => campaigns.filter((c) => !locked.has(String(c._id))), [campaigns, locked]);
  const coordinators = useMemo(
    () =>
      (historyQ.data?.coordinators || [])
        .filter((c) => String(c.id) !== String(userId))
        .map((c) => ({ id: String(c.id), name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [historyQ.data, userId]
  );
  const crewNameById = useMemo(() => coordinatorNames(historyQ.data?.coordinators), [historyQ.data]);
  const n = pickCount(picks);
  const first = person?.firstName || 'This person';

  const submit = () => {
    if (busy || !n) return;
    addMut.mutate(
      { campaigns: picksBody(picks, offered.map((c) => String(c._id))) },
      {
        onSuccess: (answer) => {
          setResult(answer);
          onAdded?.(answer);
        },
      }
    );
  };

  let title;
  let body;
  let actions;
  if (result) {
    const view = profileDoneView(result.campaigns, { firstName: person?.firstName, crewNameById });
    title = view.title;
    body = view.lines.map((line, i) => (
      <Text key={i} style={i === 0 ? styles.body : styles.note}>
        {line}
      </Text>
    ));
    actions = (
      <Pressable onPress={onClose} style={styles.btnPrimary}>
        <Text style={styles.btnPrimaryText}>Done</Text>
      </Pressable>
    );
  } else {
    title = 'Add to campaigns';
    body = historyQ.isLoading ? (
      <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.lg }} />
    ) : historyQ.isError ? (
      <>
        <Text style={styles.error}>Couldn't load their campaigns. Check your connection and try again.</Text>
        <Pressable onPress={() => historyQ.refetch()} style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </>
    ) : !offered.length ? (
      <Text style={styles.body}>{`${first} is already on every active campaign.`}</Text>
    ) : (
      <>
        <Text style={styles.sub}>Check the campaigns to put them on. Each one gets its own coordinator.</Text>
        <CampaignPicks
          campaigns={offered}
          lockedIds={locked}
          histories={histories}
          coordinators={coordinators}
          person={person}
          picks={picks}
          onChange={setPicks}
          disabled={busy}
        />
        {addMut.error ? <Text style={styles.error}>{addMut.error.message}</Text> : null}
      </>
    );
    actions = (
      <>
        <Pressable onPress={onClose} style={styles.btnGhost} disabled={busy}>
          <Text style={styles.btnGhostText}>Cancel</Text>
        </Pressable>
        {offered.length ? (
          <Pressable onPress={submit} style={[styles.btnPrimary, (busy || !n) && { opacity: 0.5 }]} disabled={busy || !n}>
            <Text style={styles.btnPrimaryText}>{busy ? 'Saving…' : submitLabel('profile', { n })}</Text>
          </Pressable>
        ) : null}
      </>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={() => !busy && onClose()} />
        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: Math.max(320, Math.round(height * 0.6)) }}>
            {body}
          </ScrollView>
          <View style={styles.actions}>{actions}</View>
        </View>
      </View>
    </Modal>
  );
};

export default AddToCampaignsSheet;

const makeStyles = (t) => {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.backdrop },
    card: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
      ...shadow.card,
    },
    title: { ...type.h3, color: colors.textPrimary, marginBottom: spacing.xs },
    sub: { ...type.caption, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.sm },
    body: { ...type.body, color: colors.textPrimary, marginTop: spacing.xs },
    note: { ...type.caption, color: colors.textSecondary, marginTop: spacing.sm },
    // dangerFg, not danger: the raw tint fails contrast at caption size (lib/theme.js).
    error: { ...type.caption, color: colors.dangerFg, marginTop: spacing.sm },
    retry: { marginTop: spacing.sm, alignSelf: 'flex-start' },
    retryText: { color: colors.brand, fontWeight: '700' },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
    btnPrimary: {
      backgroundColor: colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
    },
    btnPrimaryText: { color: colors.textInverse, fontWeight: '700' },
    btnGhost: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
    btnGhostText: { color: colors.textMuted, fontWeight: '600' },
  });
};
