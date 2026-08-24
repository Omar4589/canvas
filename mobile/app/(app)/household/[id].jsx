import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { recordHouseholdAction } from '../../../lib/recordAction';
import { guardedPush } from '../../../lib/navGuard';
import { buildingKey } from '../../../lib/buildings';
import { loadRoleContext } from '../../../lib/role';
import FixPinModal from '../../../components/FixPinModal';
import VoterMeta from '../../../components/VoterMeta';
import { timeAgo, formatExact } from '../../../lib/datetime';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

function findHouseholdAndVoters(bootstrap, householdId) {
  const household = (bootstrap?.households || []).find(
    (h) => String(h._id) === String(householdId)
  );
  const voters = (bootstrap?.voters || []).filter(
    (v) => String(v.householdId) === String(householdId)
  );
  return { household, voters };
}

function initials(fullName) {
  return (fullName || '')
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function StatusPill({ status }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const dotColor = colors.status[status] || colors.textMuted;
  const isDone = status === 'surveyed' || status === 'lit_dropped';
  const isRefused = status === 'refused';
  const bg = isDone ? colors.successBg : isRefused ? colors.warnBg : colors.bg;
  const border = isDone
    ? colors.successBorder
    : isRefused
    ? colors.warnBorder
    : colors.border;
  const textColor = isDone
    ? colors.success
    : isRefused
    ? colors.warnFg
    : colors.textSecondary;
  return (
    <View style={[styles.pill, { backgroundColor: bg, borderColor: border }]}>
      <View style={[styles.pillDot, { backgroundColor: dotColor }]} />
      <Text style={[styles.pillText, { color: textColor }]}>
        {colors.statusLabels[status] || 'Unknown'}
      </Text>
    </View>
  );
}

function VoterCard({ voter, onPress }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const surveyed = voter.surveyStatus === 'surveyed';
  // Do-not-contact wins over surveyed in every visual branch — the card must
  // read "skip this person", not "done with this person".
  const dnc = !!voter.dnc;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.voterCard,
        pressed && { opacity: 0.85 },
        surveyed && styles.voterCardSurveyed,
        dnc && styles.voterCardDnc,
      ]}
    >
      <View
        style={[
          styles.voterAvatar,
          surveyed && { backgroundColor: colors.successBg },
          dnc && { backgroundColor: colors.dangerBg },
        ]}
      >
        <Text
          style={[
            styles.voterAvatarText,
            surveyed && { color: colors.success },
            dnc && { color: colors.danger },
          ]}
        >
          {initials(voter.fullName)}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.voterName}>{voter.fullName}</Text>
          {dnc ? (
            <View style={styles.dncPill}>
              <Text style={styles.dncPillText}>⛔ Do not contact</Text>
            </View>
          ) : voter.voted ? (
            <View style={styles.votedPill}>
              <Text style={styles.votedPillText}>✓ Voted</Text>
            </View>
          ) : null}
        </View>
        <VoterMeta voter={voter} style={styles.voterMeta} />
        <View style={styles.voterStatusRow}>
          <View
            style={[
              styles.voterStatusDot,
              {
                backgroundColor: dnc
                  ? colors.danger
                  : surveyed
                  ? colors.success
                  : colors.textMuted,
              },
            ]}
          />
          <Text
            style={[
              styles.voterStatusText,
              {
                color: dnc
                  ? colors.danger
                  : surveyed
                  ? colors.success
                  : colors.textSecondary,
              },
            ]}
          >
            {dnc ? 'Do not contact' : surveyed ? 'Surveyed' : 'Not surveyed'}
          </Text>
        </View>
      </View>
      {dnc ? (
        <View style={styles.voterCtaDnc}>
          <Text style={styles.voterCtaDncText}>No contact</Text>
        </View>
      ) : (
        <View style={styles.voterCta}>
          <Text style={styles.voterCtaText}>
            {surveyed ? 'Re-survey' : 'Take survey'}
          </Text>
          <Text style={styles.voterCtaChevron}>›</Text>
        </View>
      )}
    </Pressable>
  );
}

export default function HouseholdDetail() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Pure reader of the cache the map maintains — must NOT auto-refetch the whole
  // campaign on mount, or a stale refetch resolving after an action would revert
  // the optimistic recolor (the blue→grey→blue flicker).
  const { data: bootstrap } = useQuery({ queryKey: ['bootstrap'], refetchOnMount: false });
  const campaignType = bootstrap?.campaign?.type || 'survey';
  // Per-campaign door-outcome toggles: a disabled outcome's button is hidden. A stale
  // bootstrap can still show one — the server then refuses with OUTCOME_DISABLED and
  // recordAction's hard-fail path re-pulls the config (missing field = older server = all on).
  const disabledOutcomes = bootstrap?.campaign?.disabledOutcomes || [];
  const outcomeOn = (k) => !disabledOutcomes.includes(k);
  // Billing entitlement: when the org is paused, new dispositions are disabled
  // (the server 402s them anyway — this is the courteous version). Missing
  // entitlement (older cache / super admin) fails open.
  const canCanvass = bootstrap?.entitlement ? bootstrap.entitlement.canCanvass !== false : true;
  const { household, voters } = findHouseholdAndVoters(bootstrap, id);

  const [note, setNote] = useState('');
  const [showFixPin, setShowFixPin] = useState(false);
  // Moving a pin is a data change with an audit trail, so it's leads/admins only — the server
  // refuses anyone else (routes/mobile/canvass.js), and this just keeps a canvasser from tapping
  // a button that can only fail. Defaults FALSE because loadRoleContext is async: defaulting true
  // would flash the affordance for every canvasser on every mount.
  const [canFixPin, setCanFixPin] = useState(false);
  useEffect(() => {
    let mounted = true;
    loadRoleContext()
      .then((ctx) => { if (mounted) setCanFixPin(!!ctx.isConsoleUser); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);
  // Once any action fires, lock the screen (firedRef blocks a second tap synchronously;
  // isSubmitting disables the buttons) — then we navigate back.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const firedRef = useRef(false);

  // Other units sharing this door's pin (for the "just this unit / whole building?" prompt).
  const myKey = household ? buildingKey(household) : null;
  const siblingCount = myKey
    ? (bootstrap?.households || []).filter(
        (h) => String(h._id) !== String(household._id) && buildingKey(h) === myKey
      ).length
    : 0;

  if (!household) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={type.body}>Household not found.</Text>
        <Pressable onPress={() => router.back()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // Gate-then-optimistic: recordHouseholdAction first acquires the GPS stamp (no
  // location = no knock), then recolors the pin and fires onAccepted — we navigate
  // back there, not unconditionally. The network write stays in the background; we
  // still never await the returned promise for navigation (that's what made the pin
  // lag behind the tap). If the gate blocks, re-enable the buttons so the canvasser
  // can fix location and tap again.
  function submitAction(action) {
    if (!canCanvass) return; // org paused — buttons are disabled, belt & braces
    if (firedRef.current) return; // double-tap: an action is already recording
    firedRef.current = true;
    setIsSubmitting(true);
    recordHouseholdAction(qc, id, action, {
      note: note.trim() || null,
      onAccepted: () => router.back(),
    })
      .then((res) => {
        if (res?.duplicate) {
          // The same action on this door is already recording — usually the list
          // quick-tap a few seconds earlier, still in flight on weak signal. That
          // first submit owns the write, so behave like accepted and go back — but
          // never silently: a note typed here rode on THIS tap and would vanish.
          if (note.trim()) {
            Alert.alert(
              'Already recording',
              'This door is already being recorded from an earlier tap, so the note typed here was not attached.'
            );
          } else {
            router.back();
          }
        }
      })
      // Every settle releases the latch: on success the screen already navigated
      // away at onAccepted (release is a no-op there), and blocked/duplicate/error
      // must re-enable the buttons — one release site instead of one per branch.
      .finally(() => {
        firedRef.current = false;
        setIsSubmitting(false);
      });
  }

  // DNC voters can't be surveyed, so they're excluded from BOTH sides of the
  // N/M counter. A door where everyone is flagged shows no counter — transient:
  // the server drops fully-DNC doors via the delta.
  const contactable = voters.filter((v) => !v.dnc);
  const surveyedCount = contactable.filter((v) => v.surveyStatus === 'surveyed').length;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Map</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.xxl,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.addressCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.address}>{household.addressLine1}</Text>
            {household.addressLine2 ? (
              <Text style={styles.address}>{household.addressLine2}</Text>
            ) : null}
            <Text style={styles.addressSub}>
              {household.city}, {household.state} {household.zipCode}
            </Text>
            {household.lastActionAt && (
              <View style={styles.lastVisitBlock}>
                <Text style={styles.lastVisitLine}>
                  Last visit{' '}
                  <Text style={styles.lastVisitStrong}>
                    {timeAgo(household.lastActionAt)}
                  </Text>
                </Text>
                <Text style={styles.lastVisitTimestamp}>
                  {formatExact(household.lastActionAt, bootstrap?.campaign?.timeZone)}
                </Text>
              </View>
            )}
          </View>
          <StatusPill status={household.status} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm }}>
          {household.coordSource === 'corrected' ? (
            <Text style={{ color: colors.brand, fontSize: 12, fontWeight: '700' }}>● Pin corrected</Text>
          ) : household.coordConfidence === 'interpolated' ? (
            <Text style={{ color: colors.warnFg, fontSize: 12, fontWeight: '700' }}>● Approximate location</Text>
          ) : (
            <View />
          )}
          {/* The badge above stays visible to everyone — a canvasser still needs to know the pin
              is approximate — but only a lead/admin gets the affordance to move it. */}
          {canFixPin ? (
            <Pressable onPress={() => setShowFixPin(true)} hitSlop={6}>
              <Text style={{ color: colors.brand, fontSize: 13, fontWeight: '700' }}>Fix pin location →</Text>
            </Pressable>
          ) : (
            <View />
          )}
        </View>

        {/* Gated at the mount, not just the button: a stale showFixPin must not be able to
            present a modal whose save can only 403. */}
        {canFixPin && (
          <FixPinModal
            visible={showFixPin}
            household={household}
            qc={qc}
            siblingCount={siblingCount}
            onClose={() => setShowFixPin(false)}
          />
        )}

        {campaignType === 'survey' && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Voters at this address</Text>
              {contactable.length > 0 && (
                <Text style={styles.sectionCount}>
                  {surveyedCount}/{contactable.length} surveyed
                </Text>
              )}
            </View>
            {voters.length === 0 && (
              <View style={styles.emptyVoters}>
                <Text style={type.caption}>
                  No registered voters listed here.
                </Text>
              </View>
            )}
            {voters.map((v) => (
              <VoterCard
                key={v._id}
                voter={v}
                onPress={() =>
                  v.dnc
                    ? Alert.alert(
                        'Do not contact',
                        'This voter has asked not to be contacted. Please skip them — this applies across all campaigns.'
                      )
                    : guardedPush(router, `/(app)/voter/${v._id}/survey`)
                }
              />
            ))}
          </>
        )}

        <Text style={styles.sectionTitle}>Optional note</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Anything worth remembering"
          placeholderTextColor={colors.textMuted}
          multiline
          style={styles.noteInput}
        />

        {/* The office marked this home Restricted from the console — a PREDICTION that the door
            is unreachable (a gate, a locked lobby), not an observation and not a permission.
            Deliberately a CARD and never the do-not-contact Alert: that Alert exists because the
            server refuses the write, and this has no such refusal by design. Every outcome button
            below stays enabled, `canCanvass` stays the only gate, and a canvasser who gets in
            should record normally — their result is better evidence than the mark and supersedes
            it (server contract, bulkRestrict.int.test.js). Neutral tokens: this is a fact about a
            gate, not a flag on anyone. `restrictedFrom` is per-round and absent on an older
            server, so the card simply never renders there. */}
        {household.restrictedFrom === 'desk' && (
          <View style={styles.deskRestrictCard}>
            <Text style={styles.deskRestrictTitle}>Marked restricted by the office</Text>
            <Text style={styles.deskRestrictBody}>
              Someone at the office expects this home to be unreachable — a gate, a locked
              building, no access. If you can reach it, work it normally; what you record here
              replaces the mark.
            </Text>
          </View>
        )}

        {!canCanvass && (
          <Text style={{ marginTop: spacing.lg, color: '#991B1B', fontSize: 13, fontWeight: '600' }}>
            Canvassing is paused for your organization — recording is disabled. Work you already
            recorded is safe.
          </Text>
        )}

        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          {campaignType === 'lit_drop' ? (
            <Pressable
              onPress={() => submitAction('lit_dropped')}
              disabled={isSubmitting || !canCanvass}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: colors.status.lit_dropped,
                  opacity: isSubmitting ? 0.6 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {household.status === 'lit_dropped'
                  ? 'Re-record drop'
                  : 'Lit dropped'}
              </Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                onPress={() => submitAction('not_home')}
                disabled={isSubmitting || !canCanvass}
                style={({ pressed }) => [
                  styles.actionButton,
                  styles.actionNotHome,
                  { opacity: isSubmitting ? 0.6 : pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={styles.actionButtonText}>Not home</Text>
              </Pressable>

              {outcomeOn('wrong_address') && (
                <Pressable
                  onPress={() => submitAction('wrong_address')}
                  disabled={isSubmitting || !canCanvass}
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.actionWrongAddress,
                    { opacity: isSubmitting ? 0.6 : pressed ? 0.85 : 1 },
                  ]}
                >
                  <Text style={styles.actionButtonText}>Wrong address</Text>
                </Pressable>
              )}

              {outcomeOn('refused') && (
                <Pressable
                  onPress={() => submitAction('refused')}
                  disabled={isSubmitting || !canCanvass}
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.actionRefused,
                    { opacity: isSubmitting ? 0.6 : pressed ? 0.85 : 1 },
                  ]}
                >
                  <Text style={styles.actionButtonText}>Refused</Text>
                </Pressable>
              )}
            </>
          )}

          {/* No Soliciting — a posted sign ended the visit. All campaign types; IS a knock. */}
          {outcomeOn('no_soliciting') && (
            <Pressable
              onPress={() => submitAction('no_soliciting')}
              disabled={isSubmitting || !canCanvass}
              style={({ pressed }) => [
                styles.actionButton,
                styles.actionNoSoliciting,
                { opacity: isSubmitting ? 0.6 : pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.actionButtonText}>No soliciting</Text>
            </Pressable>
          )}

          {/* Restricted Access — inaccessible home. All campaign types; not a knock. */}
          {outcomeOn('restricted') && (
            <Pressable
              onPress={() => submitAction('restricted')}
              disabled={isSubmitting || !canCanvass}
              style={({ pressed }) => [
                styles.actionButton,
                styles.actionRestricted,
                { opacity: isSubmitting ? 0.6 : pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.actionButtonText}>Restricted access</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  back: { color: colors.brand, fontWeight: '700', fontSize: 16 },

  addressCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginTop: spacing.xs,
  },
  address: { ...type.h2, fontSize: 18 },
  addressSub: { ...type.caption, marginTop: 2 },
  lastVisitBlock: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lastVisitLine: { fontSize: 12, color: colors.textSecondary },
  lastVisitStrong: { color: colors.textPrimary, fontWeight: '700' },
  lastVisitTimestamp: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },

  // Informational, never alarming — surface tokens, not the danger palette. See the card's
  // comment in the body: red is reserved for things that are wrong, and this is not one.
  deskRestrictCard: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.sunken,
  },
  deskRestrictTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  deskRestrictBody: { marginTop: 4, fontSize: 12, lineHeight: 17, color: colors.textSecondary },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginLeft: spacing.sm,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  pillText: { fontSize: 11, fontWeight: '700' },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...type.micro,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionCount: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },

  emptyVoters: {
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },

  voterCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    gap: spacing.md,
  },
  voterCardSurveyed: {
    borderColor: colors.successBorder,
  },
  voterCardDnc: {
    borderColor: colors.dangerBorder,
  },
  voterAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voterAvatarText: {
    color: colors.brand,
    fontWeight: '800',
    fontSize: 16,
  },
  voterName: { ...type.bodyStrong, fontSize: 15 },
  votedPill: {
    backgroundColor: colors.successBg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  votedPillText: { fontSize: 10, fontWeight: '700', color: colors.success },
  dncPill: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  dncPillText: { fontSize: 10, fontWeight: '700', color: colors.danger },
  voterMeta: { ...type.caption, marginTop: 2 },
  voterStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  voterStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  voterStatusText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  voterCta: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  voterCtaText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 13,
  },
  voterCtaChevron: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 16,
    marginLeft: 4,
  },
  // Deliberately not a CTA — a DNC voter has nothing to tap through to.
  voterCtaDnc: {
    backgroundColor: colors.sunken,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  voterCtaDncText: {
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: 13,
  },

  noteInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    minHeight: 88,
    textAlignVertical: 'top',
    color: colors.textPrimary,
  },

  primaryButton: {
    backgroundColor: colors.brand,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  primaryButtonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
  actionButton: {
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  actionNotHome: { backgroundColor: colors.info },
  actionWrongAddress: { backgroundColor: colors.danger },
  actionRefused: { backgroundColor: colors.status.refused },
  actionRestricted: { backgroundColor: colors.status.restricted },
  actionNoSoliciting: { backgroundColor: colors.status.no_soliciting },
  actionButtonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
  });
}
