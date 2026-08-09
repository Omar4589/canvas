import { useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PasswordInput from './PasswordInput';
import { formatUsPhoneInput, isValidTempPassword, tempPasswordProblem } from '../lib/validators';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// Add-a-canvasser sheet for the Users hub — creates (or links) straight onto the selected
// campaign via POST /admin/campaigns/:id/crew, which auto-assigns and accepts coordinatorId.
// The COORDINATOR picker is here for every console role (lead, admin, super) — item D7: a
// canvasser born onto a crew shouldn't need a second trip to the member sheet.
export default function CreateCanvasserSheet({
  campaignName,
  coordinators = [], // [{ id, name }] active admins+leads
  onClose,
  onCreate, // (body) => void — body includes coordinatorId when picked
  submitting,
  error,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [coordinatorId, setCoordinatorId] = useState('');
  const [coordOpen, setCoordOpen] = useState(false);

  // There used to be an "Existing user (by email)" checkbox here, plus an effect that ticked it for
  // you when the server answered EMAIL_EXISTS_USE_LINK so you could submit a second time. The server
  // now resolves the address itself and does the right thing on the first try: a colleague is put on
  // the campaign, an unused address becomes a new account, and an address that turns out to have an
  // account elsewhere attaches that real person (the caller is told WHO in the response — see the
  // `attached` handling in the Users hub). Nothing left for the operator to guess at.

  // The temp password is OPTIONAL. Blank → the server generates a throwaway nobody sees and
  // the new canvasser sets their own via the emailed set-password link.
  const valid = firstName.trim() && lastName.trim() && email.trim() && (password === '' || isValidTempPassword(password));
  const pwProblem = password.length > 0 ? tempPasswordProblem(password) : null;

  function submit() {
    if (!valid || submitting) return;
    onCreate({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim() || undefined,
      password,
      ...(coordinatorId ? { coordinatorId } : {}),
    });
  }

  const coordName = coordinatorId ? coordinators.find((c) => c.id === coordinatorId)?.name : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <Text style={styles.title}>Add a canvasser</Text>
          <Text style={styles.sub}>
            {`Adds someone to ${campaignName || 'this campaign'}. If the email already has a Door Line account we'll add that person; otherwise we'll create one and email them a link to set their own password.`}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 400 }}>
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
            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="jane@example.com"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
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
            <Text style={[styles.sub, { marginTop: spacing.xs }]}>
              The name and password apply only if we create a new account — if the address already
              has one, that person is added as they are.
            </Text>

            {/* Coordinator — optional; the server assigns the crew at create time. */}
            {coordinators.length > 0 && (
              <>
                <Text style={styles.label}>Coordinator (optional)</Text>
                <Pressable style={styles.dropdown} onPress={() => setCoordOpen((v) => !v)}>
                  <Text style={styles.dropdownText}>{coordName || 'No coordinator'}</Text>
                  <Text style={{ color: colors.textMuted }}>{coordOpen ? '▴' : '▾'}</Text>
                </Pressable>
                {coordOpen ? (
                  <View style={styles.dropdownList}>
                    {[{ id: '', name: 'No coordinator' }, ...coordinators].map((c) => {
                      const on = coordinatorId === c.id;
                      return (
                        <Pressable
                          key={c.id || 'none'}
                          onPress={() => {
                            setCoordinatorId(c.id);
                            setCoordOpen(false);
                          }}
                          style={[styles.dropdownItem, on && { backgroundColor: colors.brandTint }]}
                        >
                          <Text style={[styles.dropdownItemText, on && { color: colors.brand, fontWeight: '700' }]}>{c.name}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </>
            )}

            {/* MEMBER_DEACTIVATED is the one refusal left on this door: the address belongs to a
                colleague whose account is switched off, which is an ORG-wide flip a lead may not
                make. The server names them so the message is actionable. */}
            {error ? <Text style={styles.error}>{error.message}</Text> : null}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.btnGhost} disabled={submitting}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} style={[styles.btnPrimary, (!valid || submitting) && { opacity: 0.5 }]} disabled={!valid || submitting}>
              <Text style={styles.btnPrimaryText}>{submitting ? 'Saving…' : 'Add to campaign'}</Text>
            </Pressable>
          </View>
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
    title: { ...type.h3, color: colors.textPrimary },
    sub: { ...type.caption, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
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
    dropdownText: { color: colors.textPrimary, fontWeight: '600' },
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
    error: { ...type.caption, color: colors.danger, marginTop: spacing.xs },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
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
}
