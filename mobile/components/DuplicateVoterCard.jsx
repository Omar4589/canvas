import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { formatInTz } from '../lib/datetime';
import { badgesFor, summaryFor } from '../lib/duplicateSurveys';
import { spacing, radius } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// One voter with more than one survey response, for the Duplicate surveys screen. Collapsed by
// default (badges alone tell you which are suspicious); tapping reveals who/when/round and the
// per-response actions. The FlaggedEntryCard shape — this screen's sibling on the audit surface.
//
// Bare on purpose: the host InsetGroup draws the card and the hairlines, so this only owns the
// row's own padding. Response rows are hand-rolled rather than InsetNavRow, which brings its own
// spacing.lg padding (double-indent inside a bare card) and its own chevron (competing with the
// expand affordance).
//
// Presentational only. Deletion arrives through `renderResponseAction` so the mutation, the
// confirm and the pending state stay on the screen that owns them and this file never learns that
// deleting is a thing.
function houseLine(h) {
  if (!h) return 'Address unavailable';
  const city = h.city ? `, ${h.city}` : '';
  const state = h.state ? ` ${h.state}` : '';
  return `${h.addressLine1 || ''}${city}${state}`.trim() || 'Address unavailable';
}

// `styles` comes in as a prop rather than each pill running useThemedStyles — the same trade
// InsetGroup's RowBody makes, since a 25-card page renders up to 75 of these.
function Pill({ styles, tone, text }) {
  return (
    <View style={[styles.pill, styles[`pill_${tone}`]]}>
      {tone === 'neutral' ? null : <View style={[styles.pillDot, styles[`pillDot_${tone}`]]} />}
      <Text style={[styles.pillText, styles[`pillText_${tone}`]]}>{text}</Text>
    </View>
  );
}

export default function DuplicateVoterCard({
  dupe,
  tz,
  onOpenVoter,
  onOpenResponse,
  renderResponseAction,
  footer,
  defaultExpanded = false,
}) {
  const styles = useThemedStyles(makeStyles);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const name = dupe.voter?.fullName || 'Unknown voter';
  const badges = badgesFor(dupe);

  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={styles.header}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${name}, surveyed ${dupe.count} times`}
        accessibilityHint={expanded ? 'Hides the responses' : 'Shows who surveyed them and when'}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
            {dupe.voter?.party ? <Text style={styles.party}>{`  ${dupe.voter.party}`}</Text> : null}
          </Text>
          <Text style={styles.addr} numberOfLines={1}>
            {houseLine(dupe.household)}
          </Text>
          {expanded ? null : <Text style={styles.summary}>{summaryFor(dupe)}</Text>}
        </View>
        <Text style={styles.chev}>{expanded ? '⌄' : '›'}</Text>
      </Pressable>

      <View style={styles.badges}>
        {badges.map((b) => (
          <Pill key={b.key} styles={styles} tone={b.tone} text={b.text} />
        ))}
      </View>

      {expanded ? (
        <View style={styles.expanded}>
          {dupe.responses.map((r) => (
            <View key={r.responseId} style={styles.respRow}>
              <Pressable
                style={styles.respPress}
                onPress={() => onOpenResponse?.(r)}
                disabled={!onOpenResponse}
                accessibilityRole={onOpenResponse ? 'button' : 'text'}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.respWho} numberOfLines={1}>
                    {`${r.canvasser?.firstName || ''} ${r.canvasser?.lastName || ''}`.trim() || 'Unknown canvasser'}
                  </Text>
                  <Text style={styles.respMeta} numberOfLines={1}>
                    {formatInTz(r.submittedAt, tz)} · {r.roundLabel}
                  </Text>
                </View>
                {onOpenResponse ? <Text style={styles.respChev}>›</Text> : null}
              </Pressable>
              {renderResponseAction ? (
                <View style={styles.respActions}>{renderResponseAction(r, dupe)}</View>
              ) : null}
            </View>
          ))}

          {footer ? <Text style={styles.footer}>{footer}</Text> : null}

          {dupe.voter && onOpenVoter ? (
            <Pressable
              style={styles.voterLink}
              onPress={() => onOpenVoter(dupe.voter.id)}
              hitSlop={6}
              accessibilityRole="button"
            >
              <Text style={styles.voterLinkText}>Open voter ›</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    // The group owns the card; this owns the row origin (spacing.lg matches InsetGroup's rows).
    card: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    name: { ...type.bodyStrong, fontSize: 15 },
    party: { ...type.caption, fontWeight: '600' },
    addr: { ...type.caption, marginTop: 1 },
    summary: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
    chev: { color: colors.textMuted, fontSize: 18, fontWeight: '600' },

    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    // `sunken` on `card` is ~1.1:1 — invisible as a fill, so the neutral pill needs the hairline
    // to exist at all (THEMING.md). The tinted pills read on their own.
    pill_neutral: { backgroundColor: colors.sunken, borderWidth: 1, borderColor: colors.border },
    pill_danger: { backgroundColor: colors.dangerBg },
    pill_info: { backgroundColor: colors.infoBg },
    pillDot: { width: 7, height: 7, borderRadius: 4 },
    // The dot may use the vivid base (3:1 graphic floor); the TEXT beside it may not — hence
    // dangerFg below. Never reuse flags.js's reviewToneColors here: its danger branch puts
    // colors.danger on dangerBg at 3.08:1, which THEMING's own table marks as failing small text.
    pillDot_danger: { backgroundColor: colors.danger },
    pillDot_info: { backgroundColor: colors.info },
    pillText: { fontSize: 11, fontWeight: '700' },
    pillText_neutral: { color: colors.textPrimary },
    pillText_danger: { color: colors.dangerFg },
    // There is no infoFg token; textPrimary on infoBg keeps the web's blue at ~14:1.
    pillText_info: { color: colors.textPrimary },

    expanded: {
      marginTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: spacing.xs,
    },
    respRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
    respPress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
    respWho: { ...type.body, fontSize: 13, fontWeight: '600' },
    // textSecondary (4.83:1), not textMuted (2.54:1) — this is 11pt text carrying the who/when an
    // audit turns on.
    respMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 1, fontVariant: ['tabular-nums'] },
    respChev: { color: colors.textMuted, fontSize: 15 },
    respActions: { flexShrink: 0 },
    footer: { fontSize: 11, color: colors.textSecondary, marginTop: spacing.xs },
    voterLink: { marginTop: spacing.sm, alignSelf: 'flex-start' },
    voterLinkText: { fontSize: 12, fontWeight: '700', color: colors.brand },
  });
}
