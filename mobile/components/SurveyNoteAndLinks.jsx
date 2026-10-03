import { Linking, StyleSheet, Text, View } from 'react-native';
import InsetGroup, { InsetActionRow } from './InsetGroup';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// What a survey block carries for the CANVASSER rather than the voter: a note, and web links to
// show the voter (docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md §E1, §H2). Drawn under a statement, a
// closing or a question's answers, on both door presentations (one block per screen and the
// single page), so the two can never present a note differently.
//
// THE NOTE IS NEVER SAID ALOUD, so it must never look like script. Everything read aloud on the
// survey screen is amber (the greeting, statements, closings, answer scripts); the note is the
// info tint under a label that says so. It arrives already filled ({{canvasser}}): the screen
// owns the canvasser's name.
//
// LINKS open only on a tap, in the device browser, with nothing about the voter or the door added
// to the URL. Those two conditions are what keep a link out of the privacy policy (§K; the same
// class as PRIVACY_VERIFICATION items 15 and 20), so never prefetch, preview or decorate one.
// openURL().catch, NEVER canOpenURL (lib/mapsLinks.js says why). http(s) only: the server refuses
// any other scheme at save, and one from an older template is dropped here, never handed to the
// OS. No QR code, by ruling: the QR lives on the printed literature.

const WEB_URL = /^https?:\/\//i;

// "https://www.example.org:8443/vote" reads "example.org": what a link saved without a label
// shows. A regex rather than `new URL`, which throws on a malformed address at the door.
const hostOf = (url) => {
  const m = /^https?:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url);
  return m ? m[1].replace(/^www\./i, '') : url;
};

const linkLabel = (link) =>
  (typeof link.label === 'string' && link.label.trim()) || hostOf(link.url);

const openLink = (url) => {
  Linking.openURL(url).catch(() => {});
};

// `note` is the filled note text ('' or null for none); `links` is the block's raw [{ label, url }].
// Renders nothing when the block has neither, so a caller can always place it.
const SurveyNoteAndLinks = ({ note, links }) => {
  const styles = useThemedStyles(makeStyles);
  const hasNote = typeof note === 'string' && note.trim().length > 0;
  const webLinks = (Array.isArray(links) ? links : []).filter(
    (l) => !!l && typeof l.url === 'string' && WEB_URL.test(l.url)
  );
  if (!hasNote && webLinks.length === 0) return null;
  return (
    <View style={styles.stack}>
      {hasNote ? (
        <View style={styles.note}>
          <Text style={styles.noteLabel}>For you — not read aloud</Text>
          <Text style={styles.noteText}>{note}</Text>
        </View>
      ) : null}
      {/* An action row, not a nav row (InsetGroup's three kinds): a verb with nothing in its
          value column, and it leaves for the browser rather than pushing a screen of ours. */}
      {webLinks.length > 0 ? (
        <InsetGroup>
          {webLinks.map((l, i) => (
            <InsetActionRow key={`${i}:${l.url}`} label={linkLabel(l)} onPress={() => openLink(l.url)} />
          ))}
        </InsetGroup>
      ) : null}
    </View>
  );
};

export default SurveyNoteAndLinks;

// The note mirrors the survey screen's amber scriptBlock in shape (tinted well, 4pt left rule,
// micro label over 14/20 text) so the two read as siblings, told apart by tint and label alone.
// infoFg, never raw `info`, for the text: `info` on `infoBg` is 3.01:1 in light (lib/theme.js).
const makeStyles = (t) => {
  const { colors, type } = t;
  return StyleSheet.create({
    stack: { gap: spacing.sm },
    note: {
      backgroundColor: colors.infoBg,
      borderLeftWidth: 4,
      borderLeftColor: colors.info,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    noteLabel: { ...type.micro, color: colors.infoFg, marginBottom: 6 },
    noteText: { fontSize: 14, lineHeight: 20, color: colors.infoFg },
  });
};
