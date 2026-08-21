// Alert glue for the shared restrict flow — the thin react-native layer over the pure,
// tested prompt builders in restrictBooks.js. Every book-level restrict entry point calls
// the first two so the scope rules (safe 'unknocked' default, second confirm before marking
// reached doors) hold everywhere by construction; the single-home entry points (admin map
// door sheet, book-detail house pop-up) call the door pair below.
import { Alert } from 'react-native';
import { buildMarkPrompt, buildUnmarkPrompt, buildMarkDoorPrompt, buildUnmarkDoorPrompt } from './restrictBooks';

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

// Single home — one plain confirm (no scope choice, no second confirm).
export const confirmMarkDoor = ({ address, onConfirm }) => {
  const prompt = buildMarkDoorPrompt({ address });
  Alert.alert(prompt.title, prompt.message, [
    { text: 'Cancel', style: 'cancel' },
    { text: prompt.confirmText, style: 'destructive', onPress: onConfirm },
  ]);
};

export const confirmUnmarkDoor = ({ address, markedBy, markedWhen, onConfirm }) => {
  const prompt = buildUnmarkDoorPrompt({ address, markedBy, markedWhen });
  Alert.alert(prompt.title, prompt.message, [
    { text: 'Cancel', style: 'cancel' },
    { text: prompt.removeText, onPress: onConfirm },
  ]);
};
