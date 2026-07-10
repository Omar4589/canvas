import { useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, ScrollView } from 'react-native';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// A small "(i)" button that opens a centered explanation card on tap (phones have no
// hover). Clones the app's existing info-popup pattern (admin/more.jsx). Pass `body`
// for a single explanation, or `items` ([{label, text}]) for a labeled key of several
// metrics (used on the Canvassers section header).
export default function InfoHint({ title, body, items }) {
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityLabel={title ? `About ${title}` : 'More info'}
        style={styles.dot}
      >
        <Text style={styles.dotText}>i</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* Stop propagation so taps inside the card don't dismiss it. */}
          <Pressable style={styles.card} onPress={() => {}}>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            {items ? (
              <ScrollView style={{ maxHeight: 360 }}>
                {items.map((it) => (
                  <View key={it.label} style={styles.item}>
                    <Text style={styles.itemLabel}>{it.label}</Text>
                    <Text style={styles.itemText}>{it.text}</Text>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.body}>{body}</Text>
            )}
            <Pressable style={styles.btn} onPress={() => setOpen(false)}>
              <Text style={styles.btnText}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    dot: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // lineHeight matches the circle's inner box (16 − 2×1 border) and
    // includeFontPadding kills Android's extra ascent, so the glyph sits
    // dead-center in the ring instead of riding high.
    dotText: {
      fontSize: 10,
      fontWeight: '800',
      color: t.colors.textMuted,
      lineHeight: 14,
      textAlign: 'center',
      includeFontPadding: false,
    },
    backdrop: {
      flex: 1,
      backgroundColor: t.colors.backdrop,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
    },
    card: {
      backgroundColor: t.colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      padding: spacing.lg,
      ...t.shadow.raised,
      width: '100%',
      maxWidth: 360,
    },
    title: { ...t.type.h3, marginBottom: spacing.sm },
    body: { ...t.type.body, color: t.colors.textSecondary },
    item: { marginBottom: spacing.md },
    itemLabel: { ...t.type.bodyStrong, fontSize: 14, marginBottom: 2 },
    itemText: { ...t.type.caption, color: t.colors.textSecondary },
    btn: {
      backgroundColor: t.colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.sm + 2,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    btnText: { color: t.colors.textInverse, fontWeight: '700', fontSize: 15 },
  });
}
