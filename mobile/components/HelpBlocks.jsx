import { View, Text, ScrollView, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// Renders the Help Center BLOCK model (parsed server-side in markdownBlocks.js) with
// themed <Text>/<View> — deliberately dependency-free so the mobile bundle gains no
// markdown lib and stays OTA-only. Shared by the article screen ([slug].jsx) and the
// inline FAQ answers on the Help index.
//
// Block types: heading | paragraph | list | callout | code.
// A span is { text, bold?, italic?, code?, href? } (flags compose).

// One inline link. An href starting with 'http' opens externally; anything else is an
// internal help-article slug (our content links look like [label](canvasser-first-day)).
function HelpLink({ href, style, children }) {
  const router = useRouter();
  const onPress = () => {
    if (href.startsWith('http')) Linking.openURL(href).catch(() => {});
    else router.push('/(app)/help/' + href);
  };
  return (
    <Text style={style} onPress={onPress}>
      {children}
    </Text>
  );
}

// Renders a spans array into a single (optionally styled) <Text>. Nested <Text> inherit
// the parent's size/color and layer on their own bold/italic/mono/link styling.
function HelpSpans({ spans, style }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Text style={style}>
      {(spans || []).map((s, i) => {
        const composed = [
          s.bold && styles.bold,
          s.italic && styles.italic,
          s.code && styles.codeInline,
          s.href && styles.link,
        ].filter(Boolean);
        if (s.href) {
          return (
            <HelpLink key={i} href={s.href} style={composed}>
              {s.text}
            </HelpLink>
          );
        }
        return (
          <Text key={i} style={composed}>
            {s.text}
          </Text>
        );
      })}
    </Text>
  );
}

// Callout accent per variant — a tinted well with a colored left rail + label.
const CALLOUTS = {
  tip: { style: 'calloutTip', label: 'Tip', icon: '💡' },
  warning: { style: 'calloutWarn', label: 'Heads up', icon: '⚠️' },
  note: { style: 'calloutNote', label: 'Note', icon: 'ℹ️' },
};

function Block({ block, styles }) {
  switch (block.type) {
    case 'heading':
      return (
        <HelpSpans
          spans={block.spans}
          style={[styles.heading, block.level === 3 ? styles.h3 : styles.h2]}
        />
      );
    case 'paragraph':
      return <HelpSpans spans={block.spans} style={styles.paragraph} />;
    case 'list':
      return (
        <View style={styles.list}>
          {(block.items || []).map((item, idx) => (
            <View key={idx} style={styles.listItem}>
              <Text style={styles.bullet}>{block.ordered ? `${idx + 1}.` : '•'}</Text>
              <HelpSpans spans={item} style={styles.listItemText} />
            </View>
          ))}
        </View>
      );
    case 'callout': {
      const cfg = CALLOUTS[block.variant] || CALLOUTS.note;
      return (
        <View style={[styles.callout, styles[cfg.style]]}>
          <Text style={[styles.calloutLabel, styles[`${cfg.style}Label`]]}>
            {cfg.icon} {cfg.label}
          </Text>
          <HelpSpans spans={block.spans} style={styles.calloutText} />
        </View>
      );
    }
    case 'code':
      return (
        <View style={styles.codeBlock}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={styles.codeText}>{block.text}</Text>
          </ScrollView>
        </View>
      );
    default:
      return null;
  }
}

export default function HelpBlocks({ blocks = [] }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View>
      {blocks.map((b, i) => (
        <Block key={i} block={b} styles={styles} />
      ))}
    </View>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    // Inline span flags (compose on top of the block's base text style).
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    codeInline: {
      fontFamily: 'monospace',
      fontSize: 13,
      color: colors.textPrimary,
      backgroundColor: colors.sunken,
    },
    link: { color: colors.brand, textDecorationLine: 'underline' },

    heading: { color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.xs },
    h2: { fontSize: 18, fontWeight: '700' },
    h3: { fontSize: 16, fontWeight: '600' },

    paragraph: { ...type.body, lineHeight: 22, marginBottom: spacing.md },

    list: { marginBottom: spacing.md },
    listItem: { flexDirection: 'row', marginBottom: spacing.xs },
    bullet: {
      ...type.body,
      color: colors.textSecondary,
      width: 22,
      lineHeight: 22,
    },
    listItemText: { ...type.body, flex: 1, lineHeight: 22 },

    callout: {
      borderRadius: radius.md,
      borderLeftWidth: 3,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    calloutLabel: { fontSize: 12, fontWeight: '700', marginBottom: 3 },
    calloutText: { ...type.body, lineHeight: 21, color: colors.textPrimary },
    calloutTip: { backgroundColor: colors.successBg, borderLeftColor: colors.success },
    calloutTipLabel: { color: colors.success },
    calloutWarn: { backgroundColor: colors.warnBg, borderLeftColor: colors.warn },
    calloutWarnLabel: { color: colors.warnFg },
    calloutNote: { backgroundColor: colors.infoBg, borderLeftColor: colors.info },
    calloutNoteLabel: { color: colors.info },

    codeBlock: {
      backgroundColor: colors.sunken,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    codeText: { fontFamily: 'monospace', fontSize: 13, color: colors.textPrimary, lineHeight: 18 },
  });
}
