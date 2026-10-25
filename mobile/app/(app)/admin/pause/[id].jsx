import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { formatInTz } from '../../../../lib/datetime';
import { formatDistance } from '../../../../lib/geo';
import { spacing, actionLabel } from '../../../../lib/theme';
import { useTheme } from '../../../../lib/ThemeContext';
import { useThemedStyles } from '../../../../lib/useThemedStyles';
import { useFocusedPoll } from '../../../../lib/useFocusedPoll';
import { summarySentence, alertLine, statusLine, secondsText, mphText, distanceLine } from '../../../../lib/pacePauseText';
import { invalidatePaceCaches } from '../../../../lib/pacePauses';
import InsetGroup, { InsetRow, InsetNavRow, InsetActionRow, InsetNoteRow, GroupFooter } from '../../../../components/InsetGroup';
import SectionHeader from '../../../../components/SectionHeader';

// One automatic pause on the phone (docs/PROPOSAL_PACE_PAUSE.md §G.3), opened from the GPS audit's Paused
// section: who and when, the plain sentence, the doors behind it, Unpause on an open one, and the canvasser's
// day. Fixing the doors is the web's Door Outcomes page; this screen says so rather than linking a page the
// phone doesn't have. A row on a campaign the viewer doesn't manage arrives as { at, fail, otherCampaign }.
const TIME = { hour: 'numeric', minute: '2-digit', second: '2-digit' };

// The hop's facts, in the order the web table reads them.
const hopLine = (v) => {
  if (v.gapSec == null) return 'First door';
  const parts = [`${secondsText(v.gapSec)} after the last house`];
  if (!v.prevOtherCampaign) {
    if (v.meters != null) parts.push(formatDistance(v.meters));
    if (v.mph != null) parts.push(mphText(v.mph));
    if (v.neededSec != null) parts.push(`needed ${secondsText(v.neededSec)}`);
  }
  if (v.surveyCheck?.fail) parts.push('survey too soon');
  return parts.join(' · ');
};

export default function PauseDetail() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams();
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const showFlash = (text) => {
    setFlash(text);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 4000);
  };

  const q = useQuery({
    queryKey: ['admin', 'pace-pauses', 'detail', id],
    queryFn: () => api(`/admin/pace-pauses/${id}`),
    enabled: !!id,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    retry: (n, err) => err?.status !== 404 && err?.status !== 403 && n < 1,
    ...useFocusedPoll(20 * 1000),
  });
  const unpauseM = useMutation({
    mutationFn: () => api(`/admin/pace-pauses/${id}/unpause`, { method: 'POST' }),
    onSuccess: () => {
      showFlash('Unpaused. They can record again.');
      invalidatePaceCaches(qc);
    },
    onError: (err) => {
      showFlash(err?.message || 'Could not unpause.');
      invalidatePaceCaches(qc);
    },
  });

  const d = q.data;
  const zone = d?.timeZone || undefined;

  // Cancel FIRST: Android lays the buttons out in array order.
  const askUnpause = () =>
    Alert.alert(
      `Unpause ${d?.name || 'this canvasser'}?`,
      'They can record again right away, and their count starts over. Nothing they saved is changed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unpause', onPress: () => unpauseM.mutate() },
      ],
      { cancelable: true }
    );

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={8}>
        <Text style={styles.back} numberOfLines={1}>‹ GPS audit</Text>
      </Pressable>
      <Text style={styles.headerTitle}>Automatic pause</Text>
      <View style={{ width: 80 }} />
    </View>
  );

  if (q.isLoading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }
  if (q.isError && !d) {
    const status = q.error?.status;
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        {header}
        <View style={styles.groupWrap}>
          <InsetGroup>
            <InsetNoteRow>
              {status === 404
                ? 'This pause is no longer here.'
                : status === 403
                  ? 'You no longer manage this campaign.'
                  : `Couldn't load the pause — ${q.error?.message || 'check your connection and try again.'}`}
            </InsetNoteRow>
            {status !== 404 && status !== 403 ? <InsetActionRow label="Try again" onPress={() => q.refetch()} /> : null}
          </InsetGroup>
        </View>
      </SafeAreaView>
    );
  }

  const blockingNow = d.status === 'paused' && d.blocking;
  const distance = distanceLine(d.medianDistanceFromHouseM, formatDistance);
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {header}
      <ScrollView contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, spacing.xxl) }}>
        <View style={styles.intro}>
          <Text style={styles.title}>{d.name || 'A canvasser'} was paused for review</Text>
          <Text style={styles.muted}>
            {d.campaignName ? `${d.campaignName} · ` : ''}
            {formatInTz(d.firedAt, zone)}
          </Text>
          <Text style={[styles.status, blockingNow && { color: colors.dangerFg }]}>{statusLine(d, zone)}</Text>
          <Text style={styles.muted}>{alertLine(d.alert, zone)}</Text>
        </View>

        {flash ? (
          <View style={styles.flash}>
            <Text style={styles.flashText}>{flash}</Text>
          </View>
        ) : null}

        <View style={styles.groupWrap}>
          <InsetGroup>
            <InsetRow label="What happened" sub={summarySentence(d.summary)} />
            {d.implausible ? (
              <InsetNoteRow>Some hops are faster than any car on these streets. Check that two phones aren't signed in to one account.</InsetNoteRow>
            ) : null}
            {distance ? <InsetNoteRow>{distance}</InsetNoteRow> : null}
            {d.canUnpause ? <InsetActionRow label={unpauseM.isPending ? 'Unpausing…' : 'Unpause'} onPress={askUnpause} disabled={unpauseM.isPending} /> : null}
            {d.day ? (
              <InsetNavRow
                label="See their day"
                sub="Every door they saved, on a map"
                onPress={() =>
                  router.push({ pathname: `/(app)/admin/canvasser/${d.userId}/day/${d.day}`, params: { campaignId: d.campaignId } })
                }
              />
            ) : null}
          </InsetGroup>
          <GroupFooter>An org admin fixes doors on the web Door Outcomes page.</GroupFooter>
        </View>

        <SectionHeader title="The doors behind the pause" />
        <View style={styles.groupWrap}>
          <InsetGroup>
            {(d.window || []).map((v, i) =>
              v.otherCampaign ? (
                <InsetRow
                  key={i}
                  label={`${formatInTz(v.at, zone, TIME)} · A door on another campaign`}
                  badge={v.fail ? { text: 'too fast' } : null}
                />
              ) : (
                <InsetRow
                  key={i}
                  label={`${formatInTz(v.at, zone, TIME)} · ${v.address || '—'}`}
                  labelLines={2}
                  unit={actionLabel(v.result)}
                  sub={hopLine(v)}
                  badge={v.fail ? { text: 'too fast' } : null}
                />
              )
            )}
          </InsetGroup>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    back: { color: colors.brand, fontWeight: '600', fontSize: 14, flexShrink: 0 },
    headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    intro: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: 2 },
    title: { ...type.h3, color: colors.textPrimary },
    muted: { ...type.caption, color: colors.textSecondary },
    status: { ...type.caption, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.xs },
    groupWrap: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
    flash: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: 10,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    flashText: { ...type.caption, color: colors.textPrimary },
  });
}
