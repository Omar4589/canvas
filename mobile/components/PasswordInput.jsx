import { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { colors, radius, spacing } from '../lib/theme';

function EyeIcon({ off }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"
        stroke={colors.textMuted}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx="12" cy="12" r="3" stroke={colors.textMuted} strokeWidth="2" />
      {off && (
        <Line
          x1="3"
          y1="3"
          x2="21"
          y2="21"
          stroke={colors.textMuted}
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </Svg>
  );
}

export default function PasswordInput({
  value,
  onChangeText,
  placeholder,
  autoComplete = 'password',
  style,
}) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={[styles.wrap, style]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoComplete={autoComplete}
        autoCorrect={false}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        hitSlop={8}
        style={styles.eyeButton}
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
      >
        <EyeIcon off={visible} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    paddingRight: 44,
    fontSize: 16,
    backgroundColor: colors.card,
    color: colors.textPrimary,
  },
  eyeButton: {
    position: 'absolute',
    right: spacing.sm,
    top: 0,
    bottom: 0,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
