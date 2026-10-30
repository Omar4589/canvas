import { useMemo, useReducer, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import PasswordInput from './PasswordInput';
import CampaignPicks from './CampaignPicks';
import { formatUsPhoneInput, isValidTempPassword, tempPasswordProblem } from '../lib/validators';
import { initialAdd, addReducer, backAction } from '../lib/addByEmail';
import {
  orgConfirmKind,
  onCampaignIds,
  historyByCampaign,
  pickCount,
  picksBody,
  submitLabel,
  coordinatorNames,
  orgDoneView,
} from '../lib/addToCampaigns';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

const ROLES = [
  { v: 'canvasser', l: 'Canvasser' },
  { v: 'lead', l: 'Team lead' },
  { v: 'admin', l: 'Admin' },
];

// Add someone from the Users hub's All campaigns pill (docs/PROPOSAL_ADD_TO_CAMPAIGNS.md §D.2), in the
// steps a campaign pill's add already takes (CreateCanvasserSheet.jsx):
//   1. the email, looked up first (POST /admin/memberships/resolve) — counted toward the same hourly limits;
//   2. what it turned out to be: a new person (name, phone, password, a role, and for a canvasser the
//      campaigns to put them on, each with its own coordinator; for a team lead the campaigns they run), a
//      colleague (campaigns; the ones they're on show checked), or a switched-off account (Switch on, with or
//      without campaigns). Campaigns are optional, and nothing is checked to start (owner rulings 2026-10-30);
//   3. what happened (POST /admin/memberships/by-email), campaign by campaign.
// It used to add the person to the organization on no campaign, with nowhere to pick one.
//
// Android back on step 2 goes back to step 1 with the email kept; elsewhere it closes the sheet, and while
// a request is out it does nothing.
const AddPersonSheet = ({
  campaigns = [], // the organization's ACTIVE campaigns, as the hub lists them
  onClose,
  onAdded, // (result) => void — refresh the caller's lists
  onOpenPerson, // (userId) => void — their profile
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [state, dispatch] = useReducer(addReducer, undefined, () => initialAdd());
  // Step 2's own fields.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('canvasser');
  const [picks, setPicks] = useState({});
  const [managedIds, setManagedIds] = useState(() => new Set());

  const resolveMut = useMutation({
    mutationFn: (email) => api('/admin/memberships/resolve', { method: 'POST', body: { email } }),
  });
  const addMut = useMutation({
    mutationFn: (body) => api('/admin/memberships/by-email', { method: 'POST', body }),
  });
  const busy = resolveMut.isPending || addMut.isPending;

  const cleanEmail = state.email.trim().toLowerCase();
  const found = state.found;
  const person = found?.person;
  const fullName = person ? `${person.firstName || ''} ${person.lastName || ''}`.trim() : '';
  const kind = orgConfirmKind(found);
  const campaignIds = campaigns.map((c) => String(c._id));
  const locked = useMemo(() => onCampaignIds(found?.campaigns), [found]);
  const histories = useMemo(() => historyByCampaign(found?.campaigns), [found]);
  // Never offer the person as their own coordinator.
  const coordinators = useMemo(
    () =>
      (found?.coordinators || [])
        .filter((c) => !person || String(c.id) !== String(person.userId))
        .map((c) => ({ id: String(c.id), name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [found, person]
  );
  const crewNameById = useMemo(() => coordinatorNames(found?.coordinators), [found]);
  // Picks only count for a role that has a campaign list: a canvasser, or anyone already here.
  const sendsPicks = kind !== 'new' || role === 'canvasser';
  const n = sendsPicks ? pickCount(picks) : 0;
  const offeredCount = campaigns.filter((c) => !locked.has(String(c._id))).length;

  const lookUp = () => {
    if (!cleanEmail || busy) return;
    resolveMut.mutate(cleanEmail, {
      onSuccess: (answer) => {
        setPicks({});
        setManagedIds(new Set());
        dispatch({ type: 'resolved', found: answer });
      },
      onError: (error) => dispatch({ type: 'failed', error }),
    });
  };

  const goBack = () => {
    addMut.reset();
    dispatch({ type: 'back' });
  };

  // The temp password is OPTIONAL. Blank → the server generates a throwaway nobody sees and the new member
  // sets their own via the emailed set-password link; only a typed one must pass min-8.
  const pwProblem = password.length > 0 ? tempPasswordProblem(password) : null;
  const newValid = !!(firstName.trim() && lastName.trim() && (password === '' || isValidTempPassword(password)));
  const label = submitLabel(kind, { n, role });
  const canSubmit =
    !busy && !!label && (kind === 'new' ? newValid : kind === 'switched-off' ? true : kind === 'colleague' ? n > 0 : false);

  const submit = () => {
    if (!canSubmit) return;
    const body =
      kind === 'new'
        ? {
            email: cleanEmail,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            phone: phone.trim() || undefined,
            password,
            role,
            campaigns: role === 'canvasser' ? picksBody(picks, campaignIds) : [],
            ...(role === 'lead' ? { managedCampaignIds: campaignIds.filter((id) => managedIds.has(id)) } : {}),
          }
        : { email: cleanEmail, campaigns: picksBody(picks, campaignIds) };
    addMut.mutate(body, {
      onSuccess: (result) => {
        dispatch({ type: 'added', result });
        onAdded?.(result);
      },
      onError: (error) => dispatch({ type: 'failed', error }),
    });
  };

  const addAnother = () => {
    resolveMut.reset();
    addMut.reset();
    setFirstName('');
    setLastName('');
    setPhone('');
    setPassword('');
    setRole('canvasser');
    setPicks({});
    setManagedIds(new Set());
    dispatch({ type: 'again' });
  };

  const onRequestClose = () => {
    const a = backAction(state, { busy });
    if (a === 'back') goBack();
    else if (a === 'close') onClose();
  };

  // The reducer keeps the last refusal in the step's words (lib/addByEmail.js errorOf): a 429 is the hourly
  // limit on email checks, the same two counters as a campaign's add, and says how long to wait.
  const errorLine = state.error ? <Text style={styles.error}>{state.error.message}</Text> : null;

  const picker = (
    <CampaignPicks
      campaigns={campaigns}
      lockedIds={locked}
      histories={histories}
      coordinators={coordinators}
      person={person || (firstName.trim() ? { firstName: firstName.trim() } : null)}
      picks={picks}
      onChange={setPicks}
      disabled={busy}
    />
  );

  let title;
  let body;
  let actions;
  if (state.step === 'email') {
    title = 'Add someone';
    body = (
      <>
        <Text style={styles.sub}>Start with their email address. If they already work with you, we'll show you who it is.</Text>
        <Text style={styles.label}>Email</Text>
        <TextInput
          value={state.email}
          onChangeText={(email) => {
            if (resolveMut.isError) resolveMut.reset();
            dispatch({ type: 'typed', email });
          }}
          onSubmitEditing={lookUp}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          returnKeyType="next"
          placeholder="jane@example.com"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          editable={!busy}
        />
        {errorLine}
      </>
    );
    actions = (
      <>
        <Pressable onPress={onClose} style={styles.btnGhost} disabled={busy}>
          <Text style={styles.btnGhostText}>Cancel</Text>
        </Pressable>
        <Pressable onPress={lookUp} style={[styles.btnPrimary, (!cleanEmail || busy) && { opacity: 0.5 }]} disabled={!cleanEmail || busy}>
          <Text style={styles.btnPrimaryText}>{resolveMut.isPending ? 'Checking…' : 'Continue'}</Text>
        </Pressable>
      </>
    );
  } else if (state.step === 'confirm') {
    const back = (
      <Pressable onPress={goBack} style={styles.btnGhost} disabled={busy}>
        <Text style={styles.btnGhostText}>Back</Text>
      </Pressable>
    );
    const submitButton = label ? (
      <Pressable onPress={submit} style={[styles.btnPrimary, !canSubmit && { opacity: 0.5 }]} disabled={!canSubmit}>
        <Text style={styles.btnPrimaryText}>{addMut.isPending ? 'Saving…' : label}</Text>
      </Pressable>
    ) : null;
    const openButton = person?.userId ? (
      <Pressable onPress={() => onOpenPerson?.(String(person.userId))} style={styles.btnSecondary} disabled={busy}>
        <Text style={styles.btnSecondaryText}>{`Open ${person.firstName || fullName}`}</Text>
      </Pressable>
    ) : null;
    if (kind === 'new') {
      // Deliberately the same step whether the address is unused or belongs to another customer's account
      // (the server's `outside`). If it turns out to have an account, the result says whose.
      title = 'New person';
      body = (
        <>
          <Text style={styles.sub}>{`No one in your organization uses ${cleanEmail}.`}</Text>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>First name</Text>
              <TextInput value={firstName} onChangeText={setFirstName} autoCapitalize="words" placeholderTextColor={colors.textMuted} style={styles.input} editable={!busy} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Last name</Text>
              <TextInput value={lastName} onChangeText={setLastName} autoCapitalize="words" placeholderTextColor={colors.textMuted} style={styles.input} editable={!busy} />
            </View>
          </View>
          <Text style={styles.label}>Phone (optional)</Text>
          <TextInput
            value={phone}
            onChangeText={(t) => setPhone(formatUsPhoneInput(t))}
            keyboardType="phone-pad"
            placeholder="(555) 123-4567"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            editable={!busy}
          />
          <Text style={styles.label}>Temporary password (optional)</Text>
          <PasswordInput value={password} onChangeText={setPassword} autoComplete="new-password" placeholder="Leave blank to email an invite" />
          {pwProblem ? <Text style={styles.error}>{pwProblem}</Text> : null}
          <Text style={styles.note}>
            Leave blank to let them set their own password via the emailed invite (recommended). Type one only if they can’t receive email.
          </Text>

          <Text style={styles.label}>Role</Text>
          <View style={styles.roleRow}>
            {ROLES.map((opt) => {
              const active = role === opt.v;
              return (
                <Pressable
                  key={opt.v}
                  onPress={() => setRole(opt.v)}
                  disabled={busy}
                  style={[styles.roleOption, active && styles.roleOptionActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.roleOptionText, active && styles.roleOptionTextActive]}>{opt.l}</Text>
                </Pressable>
              );
            })}
          </View>

          {role === 'canvasser' ? (
            <>
              <Text style={styles.label}>Campaigns (optional)</Text>
              {picker}
              {campaigns.length ? (
                <Text style={styles.note}>{`Leave them all unchecked to add ${firstName.trim() || 'them'} to your organization only.`}</Text>
              ) : null}
            </>
          ) : role === 'lead' ? (
            <>
              <Text style={styles.label}>Campaigns they run</Text>
              {campaigns.length ? (
                campaigns.map((c) => {
                  const id = String(c._id);
                  const on = managedIds.has(id);
                  return (
                    <Pressable
                      key={id}
                      onPress={() =>
                        setManagedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                      disabled={busy}
                      style={styles.leadRow}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
                      <Text style={styles.leadName} numberOfLines={2}>
                        {c.name}
                      </Text>
                    </Pressable>
                  );
                })
              ) : (
                <Text style={styles.note}>No active campaigns yet.</Text>
              )}
              <Text style={styles.note}>A team lead can run only the campaigns checked.</Text>
              {managedIds.size === 0 ? (
                <Text style={[styles.note, { color: colors.warnFg }]}>No campaigns checked — this lead won't be able to manage anything yet.</Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.note}>Admins see and run every campaign.</Text>
          )}
          {errorLine}
        </>
      );
      actions = (
        <>
          {back}
          {submitButton}
        </>
      );
    } else if (kind === 'colleague') {
      title = `Add ${fullName || 'them'} to campaigns?`;
      const roleNote = person?.role === 'lead' ? ' (a team lead)' : person?.role === 'admin' ? ' (an admin)' : '';
      body = (
        <>
          <Text style={styles.body}>{`${fullName} is already in your organization${roleNote}.`}</Text>
          <Text style={styles.label}>Campaigns</Text>
          {picker}
          {campaigns.length && !offeredCount ? (
            <Text style={styles.note}>{`${person?.firstName || fullName} is already on every active campaign.`}</Text>
          ) : null}
          <Text style={styles.note}>Adding them doesn’t change their role.</Text>
          {errorLine}
        </>
      );
      actions = (
        <>
          {back}
          {openButton}
          {submitButton}
        </>
      );
    } else if (kind === 'switched-off') {
      title = 'Account switched off';
      body = (
        <>
          <Text style={styles.body}>{`${fullName} is in your organization, but their account is switched off.`}</Text>
          <Text style={styles.label}>Campaigns (optional)</Text>
          {picker}
          <Text style={styles.note}>Switching it back on restores their access to every campaign they were on.</Text>
          {errorLine}
        </>
      );
      actions = (
        <>
          {back}
          {openButton}
          {submitButton}
        </>
      );
    } else {
      // An answer this build doesn't know.
      title = 'Something went wrong';
      body = (
        <>
          <Text style={styles.body}>Go back and try that email again.</Text>
          {errorLine}
        </>
      );
      actions = back;
    }
  } else {
    const view = orgDoneView(state.result, { crewNameById });
    title = view.title;
    body = (
      <>
        {view.lines.map((line, i) => (
          <Text key={i} style={i === 0 ? styles.body : styles.note}>
            {line}
          </Text>
        ))}
      </>
    );
    const landedId = state.result?.user?.id;
    actions = (
      <>
        <Pressable onPress={addAnother} style={styles.btnGhost}>
          <Text style={styles.btnGhostText}>Add another</Text>
        </Pressable>
        {landedId ? (
          <Pressable onPress={() => onOpenPerson?.(String(landedId))} style={styles.btnSecondary}>
            <Text style={styles.btnSecondaryText}>{`Open ${view.first}`}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} style={styles.btnPrimary}>
          <Text style={styles.btnPrimaryText}>Done</Text>
        </Pressable>
      </>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onRequestClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={() => !busy && onClose()} />
        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
            {body}
          </ScrollView>
          <View style={styles.actions}>{actions}</View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default AddPersonSheet;

const makeStyles = (t) => {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.backdrop },
    // Bounded by what the KeyboardAvoidingView leaves above the keyboard, with the step scrolling inside
    // (`scroll`): a fixed cap ignored the keyboard, and the card then grew past the top of the screen and
    // hid the name fields being typed into.
    card: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
      maxHeight: '90%',
      ...shadow.card,
    },
    scroll: { flexGrow: 0, flexShrink: 1 },
    title: { ...type.h3, color: colors.textPrimary, marginBottom: spacing.xs },
    sub: { ...type.caption, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
    body: { ...type.body, color: colors.textPrimary, marginTop: spacing.xs },
    note: { ...type.caption, color: colors.textSecondary, marginTop: spacing.sm },
    label: { ...type.caption, color: colors.textMuted, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: colors.textPrimary,
      backgroundColor: colors.bg,
    },
    row2: { flexDirection: 'row', gap: spacing.md },
    roleRow: { flexDirection: 'row', gap: spacing.sm },
    roleOption: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingVertical: spacing.sm + 2,
      alignItems: 'center',
    },
    roleOptionActive: { borderColor: colors.brand, backgroundColor: colors.brandTint },
    roleOptionText: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
    roleOptionTextActive: { color: colors.brand, fontWeight: '700' },
    leadRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
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
    checkMark: { color: colors.textInverse, fontSize: 12, fontWeight: '800' },
    leadName: { ...type.body, fontSize: 14, flex: 1, color: colors.textPrimary },
    // dangerFg, not danger: the raw tint fails contrast at caption size (lib/theme.js).
    error: { ...type.caption, color: colors.dangerFg, marginTop: spacing.sm },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
    btnPrimary: {
      backgroundColor: colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
    },
    btnPrimaryText: { color: colors.textInverse, fontWeight: '700' },
    btnSecondary: {
      borderWidth: 1,
      borderColor: colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
    },
    btnSecondaryText: { color: colors.brand, fontWeight: '700' },
    btnGhost: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
    btnGhostText: { color: colors.textMuted, fontWeight: '600' },
  });
};
