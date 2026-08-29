import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { recordAddVoter } from '../lib/recordAction';
import { newObjectIdHex } from '../lib/objectId';
import { formatUsPhoneInput, isValidUsPhone } from '../lib/validators';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';

// UX-only email check — the server's voterEmailSchema is the real guard.
const looksLikeEmail = (s) => /^\S+@\S+\.\S+$/.test(s);

// Add a walk-up voter at the door: someone the canvasser is speaking to who lives here but
// isn't on the imported list. Name required; phone/email optional (candidate follow-up).
// Saves immediately via recordAddVoter (optimistic + offline-safe, client-minted id), then
// hands the new voter's id to onAdded — the household screen navigates into their survey.
// A modal, not a route, on the FixPinModal pattern: the URL stays /household/[id], which the
// OTA restart guard's canvass-flow shield already covers.
export default function AddPersonModal({ visible, householdId, qc, onAdded, onClose }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets(); // clear the Android nav bar / iOS home indicator
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFirstName('');
    setLastName('');
    setPhone('');
    setEmail('');
  };

  const save = () => {
    const first = firstName.trim();
    const last = lastName.trim();
    const mail = email.trim();
    if (!first || !last) {
      Alert.alert('Name required', 'Enter the first and last name of the person you spoke to.');
      return;
    }
    if (phone.trim() && !isValidUsPhone(phone)) {
      Alert.alert('Check the phone number', 'Enter a valid US phone number, e.g. (555) 123-4567.');
      return;
    }
    if (mail && !looksLikeEmail(mail)) {
      Alert.alert('Check the email', 'That email address doesn’t look right.');
      return;
    }
    if (busy) return;
    setBusy(true);
    const voterId = newObjectIdHex();
    recordAddVoter(qc, householdId, {
      voterId,
      firstName: first,
      lastName: last,
      phone: phone.trim() || null,
      email: mail || null,
      // Fires once the GPS gate passes and the voter is in the cache — the person is
      // definitely being added, so close and let the parent open their survey.
      onAccepted: () => {
        reset();
        onClose();
        onAdded(voterId);
      },
    })
      .then((res) => {
        if (res?.duplicate) {
          // An add at this door is already in flight (a double-tap racing weak signal) —
          // that first submit owns the write; this one recorded nothing.
          Alert.alert('Already adding', 'Someone is already being added at this door. Give it a moment.');
        }
      })
      // Blocked GPS / duplicate / hard error all land here with the modal still open —
      // re-enable Save so the canvasser can fix the issue and try again. On success the
      // modal already closed at onAccepted; the reset makes this a no-op there.
      .finally(() => setBusy(false));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: spacing.lg + insets.bottom }]}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>Add a person</Text>
            <Text style={[styles.sub, { color: colors.textSecondary }]}>
              Someone who lives here but isn't on your list. They'll be saved to this address and
              you can take their survey right away.
            </Text>

            <View style={styles.nameRow}>
              <TextInput
                value={firstName}
                onChangeText={setFirstName}
                placeholder="First name"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
                autoCorrect={false}
                style={[styles.input, { flex: 1, borderColor: colors.border, color: colors.textPrimary }]}
              />
              <TextInput
                value={lastName}
                onChangeText={setLastName}
                placeholder="Last name"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
                autoCorrect={false}
                style={[styles.input, { flex: 1, borderColor: colors.border, color: colors.textPrimary }]}
              />
            </View>
            <TextInput
              value={phone}
              onChangeText={(v) => setPhone(formatUsPhoneInput(v))}
              placeholder="Phone (optional)"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              style={[styles.input, { borderColor: colors.border, color: colors.textPrimary }]}
            />
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email (optional)"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { borderColor: colors.border, color: colors.textPrimary }]}
            />
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              Phone and email are only if they'd like to be contacted back.
            </Text>

            <View style={styles.actions}>
              <Pressable onPress={onClose} style={[styles.btn, { borderColor: colors.border }]}>
                <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={save}
                disabled={busy}
                style={[styles.btn, styles.primary, { backgroundColor: colors.brand, opacity: busy ? 0.6 : 1 }]}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>
                  {busy ? 'Adding…' : 'Add & take survey'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  title: { fontSize: 18, fontWeight: '700' },
  sub: { fontSize: 13 },
  nameRow: { flexDirection: 'row', gap: spacing.sm },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: 15 },
  hint: { fontSize: 12 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btn: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  primary: { borderWidth: 0 },
});
