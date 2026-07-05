import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import { passwordChecklist } from '../lib/validators';

// Live checklist for a USER-CHOSEN password — rules mirror mobile/lib/validators.js (and the
// server, the real guard). Renders nothing until typing starts, then ticks each rule green.
function CheckMark({ color }) {
  return (
    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
      <Path d="M20 6 9 17l-5-5" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export default function PasswordRequirements({ password }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (!password) return null;
  const items = passwordChecklist(password);
  return (
    <View style={styles.wrap} accessibilityLabel="Password requirements">
      {items.map((it) => (
        <View key={it.key} style={styles.row}>
          <View style={[styles.dot, it.ok ? styles.dotOk : styles.dotOff]}>
            {it.ok ? <CheckMark color={colors.success} /> : null}
          </View>
          <Text style={[styles.label, it.ok && styles.labelOk]}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

function makeStyles(t) {
  const { colors } = t;
  return StyleSheet.create({
    wrap: { marginTop: spacing.sm, gap: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    dot: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dotOk: { borderColor: colors.success, backgroundColor: colors.successBg },
    dotOff: { borderColor: colors.border },
    label: { fontSize: 12, color: colors.textMuted },
    labelOk: { color: colors.success },
  });
}
