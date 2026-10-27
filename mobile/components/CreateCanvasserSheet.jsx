import { useReducer, useState } from 'react';
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
import { formatUsPhoneInput, isValidTempPassword, tempPasswordProblem } from '../lib/validators';
import {
  initialAdd,
  addReducer,
  backAction,
  confirmKind,
  prePick,
  historyLine,
  joinLine,
  doneView,
} from '../lib/addByEmail';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// Add-a-canvasser sheet for the Users hub, in the web's steps (docs/PROPOSAL_PEOPLE_PAGES.md §G, §E.6):
//   1. the email, looked up first (POST /admin/campaigns/:id/crew/resolve) — it counts toward the same
//      hourly limits as the web's lookups, and a 429 says how long to wait;
//   2. what it turned out to be: a new person (their name, phone and password), a colleague, a
//      switched-off account, or someone already here — with their doors on this campaign from before
//      and the coordinator they'd join, their old one picked when it can still run a crew;
//   3. what happened (POST …/crew), including which teams their earlier doors moved from.
// It used to add straight away, which could switch someone back on without saying so or add an
// existing account without saying whose. The steps and their sentences live in lib/addByEmail.js.
//
// Android back on step 2 goes back to step 1 with the email kept; elsewhere it closes the sheet, and
// while a request is out it does nothing.
export default function CreateCanvasserSheet({
  campaignId,
  campaignName,
  coordinators = [], // [{ id, name }] who can run a crew: GET …/crew's `coordinators`
  coordinatorsStatus = 'success', // that query's status: 'pending' | 'error' | 'success'
  isAdmin = false, // org admin or Doorline staff: switching an account back on is theirs
  onClose,
  onAdded, // (result) => void — refresh the caller's lists
  onOpenPerson, // (userId) => void — "Open {name}": their member sheet on this campaign
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [state, dispatch] = useReducer(addReducer, undefined, () => initialAdd());
  // Step 2's own fields. The crew starts at the pre-pick each time an email is looked up.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [pick, setPick] = useState(''); // '' = no coordinator
  const [coordOpen, setCoordOpen] = useState(false);
  // The crew as it was sent, for the result's "moved … to {team}".
  const [sentCrewName, setSentCrewName] = useState(null);

  const resolveMut = useMutation({
    mutationFn: (email) => api(`/admin/campaigns/${campaignId}/crew/resolve`, { method: 'POST', body: { email } }),
  });
  const addMut = useMutation({
    mutationFn: (body) => api(`/admin/campaigns/${campaignId}/crew`, { method: 'POST', body }),
  });
  const busy = resolveMut.isPending || addMut.isPending;

  const cleanEmail = state.email.trim().toLowerCase();
  const found = state.found;
  const person = found?.person;
  const fullName = person ? `${person.firstName || ''} ${person.lastName || ''}`.trim() : '';
  const kind = confirmKind(found, { isAdmin });
  // Never offer the person as their own coordinator.
  const choices = coordinators.filter((c) => !person || c.id !== String(person.userId));
  // A pre-picked coordinator is named from their history until the list of who can run a crew arrives.
  const pickName = pick
    ? choices.find((c) => c.id === pick)?.name ||
      (found?.history?.sources || []).find((s) => String(s.coordinatorId) === pick)?.name ||
      null
    : null;
  const earlierCrewId = prePick(found?.history);

  const lookUp = () => {
    if (!cleanEmail || busy) return;
    resolveMut.mutate(cleanEmail, {
      onSuccess: (answer) => {
        // Their old crew, when its coordinator can still lead (`canLead` is the rule the add enforces,
        // the same set the coordinator list holds), otherwise No coordinator.
        setPick(prePick(answer?.history) || '');
        setCoordOpen(false);
        dispatch({ type: 'resolved', found: answer });
      },
      onError: (error) => dispatch({ type: 'failed', error }),
    });
  };

  const goBack = () => {
    addMut.reset();
    setCoordOpen(false);
    dispatch({ type: 'back' });
  };

  // The temp password is OPTIONAL. Blank → the server generates a throwaway nobody sees and the new
  // canvasser sets their own via the emailed set-password link; only a typed one must pass min-8.
  const pwProblem = password.length > 0 ? tempPasswordProblem(password) : null;
  const newValid = firstName.trim() && lastName.trim() && (password === '' || isValidTempPassword(password));

  const submit = () => {
    if (busy || !kind.submit || (kind.kind === 'new' && !newValid)) return;
    // The crew: the one picked, or null for No crew. Switch on alone sends none: their crew stays.
    const crew = kind.crew ? { coordinatorId: pick || null } : {};
    const body =
      kind.kind === 'new'
        ? {
            email: cleanEmail,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            phone: phone.trim() || undefined,
            password,
            ...crew,
          }
        : { email: cleanEmail, ...crew };
    setSentCrewName(kind.crew ? pickName : null);
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
    setPick('');
    setCoordOpen(false);
    dispatch({ type: 'again' });
  };

  const openPerson = (userId) => {
    if (!userId) return;
    onOpenPerson?.(String(userId));
  };

  const onRequestClose = () => {
    const a = backAction(state, { busy });
    if (a === 'back') goBack();
    else if (a === 'close') onClose();
  };

  const errorLine = state.error ? <Text style={styles.error}>{state.error.message}</Text> : null;

  // The coordinator a returning person would join, with what that does to their doors here.
  const crewChoice = kind.crew ? (
    <>
      <Text style={styles.label}>Coordinator</Text>
      <Pressable style={styles.dropdown} onPress={() => setCoordOpen((v) => !v)} disabled={busy}>
        <Text style={styles.dropdownText}>
          {pickName ? `${pickName}${pick === earlierCrewId ? ' (their crew before)' : ''}` : 'No coordinator'}
        </Text>
        <Text style={{ color: colors.textMuted }}>{coordOpen ? '▴' : '▾'}</Text>
      </Pressable>
      {coordOpen ? (
        <View style={styles.dropdownList}>
          {[{ id: '', name: 'No coordinator' }, ...choices].map((c) => {
            const on = pick === c.id;
            return (
              <Pressable
                key={c.id || 'none'}
                onPress={() => {
                  setPick(c.id);
                  setCoordOpen(false);
                }}
                style={[styles.dropdownItem, on && { backgroundColor: colors.brandTint }]}
              >
                <Text style={[styles.dropdownItemText, on && { color: colors.brand, fontWeight: '700' }]}>
                  {c.name}
                  {c.id && c.id === earlierCrewId ? ' (their crew before)' : ''}
                </Text>
              </Pressable>
            );
          })}
          {coordinatorsStatus === 'pending' ? (
            <View style={styles.dropdownItem}>
              <Text style={[styles.dropdownItemText, { color: colors.textMuted }]}>Loading who can run a crew…</Text>
            </View>
          ) : coordinatorsStatus === 'error' ? (
            <View style={styles.dropdownItem}>
              <Text style={[styles.dropdownItemText, { color: colors.danger }]}>Couldn't load who can run a crew.</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {joinLine(found?.history, pick || null, pickName) ? (
        <Text style={styles.note}>{joinLine(found?.history, pick || null, pickName)}</Text>
      ) : null}
    </>
  ) : null;

  let title;
  let body;
  let actions;
  if (state.step === 'email') {
    title = 'Add a canvasser';
    body = (
      <>
        <Text style={styles.sub}>
          {`Start with their email address. If they already have an account we'll add that person to ${campaignName || 'this campaign'}; if not, you'll create one.`}
        </Text>
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
        <Pressable
          onPress={lookUp}
          style={[styles.btnPrimary, (!cleanEmail || busy) && { opacity: 0.5 }]}
          disabled={!cleanEmail || busy}
        >
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
    const submitButton = kind.submit ? (
      <Pressable
        onPress={submit}
        style={[styles.btnPrimary, (busy || (kind.kind === 'new' && !newValid)) && { opacity: 0.5 }]}
        disabled={busy || (kind.kind === 'new' && !newValid)}
      >
        <Text style={styles.btnPrimaryText}>{addMut.isPending ? 'Saving…' : kind.submit}</Text>
      </Pressable>
    ) : null;
    const history = historyLine(person, found?.history);
    if (kind.kind === 'new') {
      // Deliberately the same answer whether the address is unused or belongs to another customer's
      // account (the server's `outside`). If it turns out to have an account, the result says whose.
      title = 'New canvasser';
      body = (
        <>
          <Text style={styles.sub}>
            {`No one in your organization uses ${cleanEmail}. Create their account and put them on ${campaignName || 'this campaign'}.`}
          </Text>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>First name</Text>
              <TextInput value={firstName} onChangeText={setFirstName} autoCapitalize="words" placeholderTextColor={colors.textMuted} style={styles.input} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Last name</Text>
              <TextInput value={lastName} onChangeText={setLastName} autoCapitalize="words" placeholderTextColor={colors.textMuted} style={styles.input} />
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
          />
          <Text style={styles.label}>Temporary password (optional)</Text>
          <PasswordInput value={password} onChangeText={setPassword} autoComplete="new-password" placeholder="Leave blank to email an invite" />
          {pwProblem ? <Text style={styles.error}>{pwProblem}</Text> : null}
          <Text style={styles.note}>
            Leave blank to let them set their own password via the emailed invite (recommended). Type one only if they can’t receive email.
          </Text>
          {crewChoice}
          {errorLine}
        </>
      );
      actions = (
        <>
          {back}
          {submitButton}
        </>
      );
    } else if (kind.kind === 'colleague') {
      title = `Add them to ${campaignName || 'this campaign'}?`;
      const roleNote = person?.role === 'lead' ? ' (a team lead)' : person?.role === 'admin' ? ' (an admin)' : '';
      body = (
        <>
          <Text style={styles.body}>{`${fullName} is already in your organization${roleNote}.`}</Text>
          {history ? <Text style={styles.body}>{history}</Text> : null}
          {crewChoice}
          <Text style={styles.note}>
            Adding them puts them on this campaign’s team so they can be given books. It doesn’t change their role or their other campaigns.
          </Text>
          {errorLine}
        </>
      );
      actions = (
        <>
          {back}
          {submitButton}
        </>
      );
    } else if (kind.kind === 'switched-off' || kind.kind === 'switch-on') {
      title = 'Account switched off';
      const here = kind.kind === 'switch-on';
      body = (
        <>
          <Text style={styles.body}>
            {here
              ? `${fullName} is on this campaign, but their account is switched off.`
              : `${fullName} is in your organization, but their account is switched off.`}
          </Text>
          {isAdmin && !here && history ? <Text style={styles.body}>{history}</Text> : null}
          {crewChoice}
          <Text style={styles.note}>
            {isAdmin
              ? here
                ? 'Switching it back on restores their access to every campaign they were on. Their coordinator here stays as it is.'
                : 'Switching it back on restores their access to every campaign they were on, not just this one.'
              : 'Switching an account back on affects every campaign in the organization, so an org admin has to do it.'}
          </Text>
          {errorLine}
        </>
      );
      actions = (
        <>
          {back}
          {submitButton || (
            <Pressable onPress={onClose} style={styles.btnPrimary}>
              <Text style={styles.btnPrimaryText}>Close</Text>
            </Pressable>
          )}
        </>
      );
    } else {
      // Already here (or an answer this build doesn't know): nothing to add.
      title = 'Already here';
      body = (
        <>
          <Text style={styles.body}>{`${fullName || cleanEmail} is already on this campaign.`}</Text>
          {errorLine}
        </>
      );
      actions = (
        <>
          {back}
          {person?.userId ? (
            <Pressable onPress={() => openPerson(person.userId)} style={styles.btnPrimary}>
              <Text style={styles.btnPrimaryText}>{`Open ${person.firstName || fullName}`}</Text>
            </Pressable>
          ) : null}
        </>
      );
    }
  } else {
    const view = doneView(state.result, { crewName: sentCrewName });
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
        {view.open && landedId ? (
          <Pressable onPress={() => openPerson(landedId)} style={styles.btnSecondary}>
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
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
            {body}
          </ScrollView>
          <View style={styles.actions}>{actions}</View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.backdrop },
    card: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      padding: spacing.lg,
      ...shadow.card,
    },
    title: { ...type.h3, color: colors.textPrimary, marginBottom: spacing.xs },
    sub: { ...type.caption, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
    body: { ...type.body, color: colors.textPrimary, marginTop: spacing.xs },
    note: { ...type.caption, color: colors.textSecondary, marginTop: spacing.sm },
    label: { ...type.caption, color: colors.textMuted, fontWeight: '700', marginTop: spacing.sm, marginBottom: spacing.xs },
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
    error: { ...type.caption, color: colors.danger, marginTop: spacing.sm },
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
}
