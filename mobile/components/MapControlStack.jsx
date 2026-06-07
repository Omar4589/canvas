import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import MapStyleControl from './MapStyleControl';
import { spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// The bottom-right map control cluster shared by the houses map and the books
// map: an optional Refresh button (with the offline-pending badge), the base-map
// / terrain picker, and a recenter / follow toggle — stacked vertically and
// right-aligned. Presentational: the PARENT owns positioning (the houses map
// rides it above the bottom sheet; the books map pins it to the safe-area
// bottom). Renders a fragment, so the parent's wrapper should be a column with
// `alignItems: 'flex-end'`.
export default function MapControlStack({
  following,
  onRecenter,
  styleId,
  onStyleChange,
  onRefresh,
  refreshing,
  pendingCount = 0,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <>
      {onRefresh && (
        <Pressable
          onPress={onRefresh}
          disabled={refreshing}
          style={[styles.button, styles.spacer]}
          accessibilityLabel="Refresh"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.brand} />
          ) : (
            <Text style={styles.glyph}>↻</Text>
          )}
          {pendingCount > 0 && (
            <View style={styles.pendingDot}>
              <Text style={styles.pendingDotText}>{pendingCount}</Text>
            </View>
          )}
        </Pressable>
      )}
      <MapStyleControl value={styleId} onChange={onStyleChange} menuDirection="up" style={styles.spacer} />
      <Pressable
        onPress={onRecenter}
        style={[styles.button, following && styles.buttonActive]}
        accessibilityLabel="Recenter"
      >
        <Text style={[styles.glyph, following && styles.glyphActive]}>◎</Text>
      </Pressable>
    </>
  );
}

function makeStyles(t) {
  const { colors, shadow } = t;
  return StyleSheet.create({
    spacer: { marginBottom: spacing.sm },
    button: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadow.raised,
    },
    buttonActive: { backgroundColor: colors.brand },
    glyph: { fontSize: 24, color: colors.brand, lineHeight: 26 },
    glyphActive: { color: colors.textInverse },
    // Offline-pending count, overlaid on the refresh button (warn semantics).
    pendingDot: {
      position: 'absolute',
      top: -5,
      right: -5,
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 4,
      backgroundColor: colors.warnBg,
      borderWidth: 1,
      borderColor: colors.warnBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pendingDotText: { fontSize: 10, fontWeight: '800', color: colors.warnFg },
  });
}
