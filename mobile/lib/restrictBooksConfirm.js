// Alert glue for the shared restrict flow — the thin react-native layer over the pure,
// tested prompt builders in restrictBooks.js. Every restrict entry point calls these two
// so the scope rules (safe 'unknocked' default, second confirm before marking reached
// doors) hold everywhere by construction.
import { Alert } from 'react-native';
import { buildMarkPrompt, buildUnmarkPrompt } from './restrictBooks';

export const confirmMarkRestricted = ({ label, counts, totalDoors, onScope }) => {
  const prompt = buildMarkPrompt({ label, counts, totalDoors });
  Alert.alert(
    prompt.title,
    prompt.message,
    prompt.buttons.map((b) => ({
      text: b.text,
      style: b.style,
      onPress:
        b.scope == null
          ? undefined
          : b.confirm
          ? // The reached-inclusive scope: a second explicit confirm before anything is sent.
            () =>
              Alert.alert(b.confirm.title, b.confirm.message, [
                { text: 'Cancel', style: 'cancel' },
                { text: b.confirm.confirmText, style: 'destructive', onPress: () => onScope(b.scope) },
              ])
          : () => onScope(b.scope),
    }))
  );
};

export const confirmUnmarkRestricted = ({ label, bulkMarks, onConfirm }) => {
  const prompt = buildUnmarkPrompt({ label, bulkMarks });
  Alert.alert(prompt.title, prompt.message, [
    { text: 'Cancel', style: 'cancel' },
    { text: prompt.removeText, onPress: onConfirm },
  ]);
};
