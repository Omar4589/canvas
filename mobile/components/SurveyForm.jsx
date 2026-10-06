import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  BackHandler,
  Keyboard,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  buildSubmitRows,
  canAdvance,
  canSkip,
  clampScreenId,
  isClosingBlock,
  isScripted,
  isStatement,
  nextScreenId,
  prevScreenId,
  progress,
  questionNumbers,
  requiredPending,
  saveScreenId,
  screenKind,
  screens,
  showDefaultClosing,
  skipAnswer,
  visibleBlocks,
} from '../lib/surveyRunner';
import { fillScript } from '../lib/surveyScriptText';
import SurveyNoteAndLinks from './SurveyNoteAndLinks';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// The survey form itself, shared by the two screens that walk a survey on the phone
// (docs/PROPOSAL_SURVEY_PRACTICE.md):
//   app/(app)/voter/[id]/survey.jsx               the door. It owns the voter: the prompts before
//                                                 the form, the do-not-contact wall, and the save.
//   app/(app)/survey-practice/[surveyId].jsx      Practice the survey. It saves nothing.
// Everything a canvasser sees and taps lives here: the answer state, the single page and one block
// per screen, scroll-to-reveal, every block, Note and the Save button. So a practice run is the
// door's survey screen for the same taps, never a look-alike.
//
// The form writes NOTHING. Save runs the required check, then hands the host the POST rows and the
// note through onSave; what happens next (optimisticSubmit at the door, a "nothing was saved"
// message in practice) is the host's. Keep it that way: a write in here would reach practice.

// One block per screen: a step control (Back, Next, Skip, Save, the jump to an unanswered
// question) pressed within this long of the last step is ignored. The footer sits in one place
// on every screen, so the second touch of a double-tap would otherwise land on the NEXT screen's
// control: Next on Close 2 becomes Save on Close 4, saving before the canvasser reads it, and
// Back on the second screen becomes Back on the first, which leaves the survey.
const STEP_GUARD_MS = 400;
// A negative gap is the phone's clock set back after the step (an automatic time correction), not
// a double-tap: counted as one, it would hold every step control until the clock caught up.
const justStepped = (stepAtRef) => {
  const sinceStep = Date.now() - stepAtRef.current;
  return sinceStep >= 0 && sinceStep < STEP_GUARD_MS;
};

// The single page of a SCRIPTED survey (isScripted): a block a tap revealed is scrolled into view
// only when its top landed in the bottom quarter of the screen or below, and is then parked a
// third of the way down, with a third of a screen still in view above it. Every other survey keeps
// the page it has always had, which never moves on its own (an existing survey keeps working
// unchanged), so a Show-only-if follow-up far below the answer that shows it never drags that
// answer and its read-aloud line off the top.
const REVEAL_FOLD = 0.75;
const REVEAL_AT = 1 / 3;

function SingleChoice({ q, value, onChange, otherText, onOtherText, fill }) {
  const styles = useThemedStyles(makeStyles);
  // Real options plus a synthetic "Other (specify)" when the question allows it.
  const opts = q.options.filter((o) => !o.retired);
  const rendered = q.otherOption
    ? [...opts, { id: '__other__', text: 'Other (specify)' }]
    : opts;
  return (
    <View style={styles.optionGrid}>
      {rendered.map((opt) => {
        const selected = value === opt.id;
        return (
          <View key={opt.id} style={styles.optionWrap}>
            <Pressable
              onPress={() => onChange(opt.id)}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{opt.text}</Text>
              <View style={[styles.radio, selected && styles.radioSelected]}>
                {selected && <View style={styles.radioInner} />}
              </View>
            </Pressable>
            {selected && opt.id !== '__other__' && opt.script ? (
              <View style={styles.scriptBlock}>
                <Text style={styles.scriptLabel}>Read aloud</Text>
                <Text style={styles.scriptText}>{fill(opt.script)}</Text>
              </View>
            ) : null}
            {selected && opt.id === '__other__' ? (
              <FreeText value={otherText} onChange={onOtherText} placeholder="Please specify" />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function MultipleChoice({ q, value, onChange, otherText, onOtherText, fill }) {
  const styles = useThemedStyles(makeStyles);
  const selected = Array.isArray(value) ? value : [];
  function toggle(id) {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  }
  // Real options plus a synthetic "Other (specify)" when the question allows it.
  const opts = q.options.filter((o) => !o.retired);
  const rendered = q.otherOption
    ? [...opts, { id: '__other__', text: 'Other (specify)' }]
    : opts;
  return (
    <View style={styles.optionGrid}>
      {rendered.map((opt) => {
        const isOn = selected.includes(opt.id);
        return (
          <View key={opt.id} style={styles.optionWrap}>
            <Pressable
              onPress={() => toggle(opt.id)}
              style={[styles.option, isOn && styles.optionSelected]}
            >
              <Text style={[styles.optionText, isOn && styles.optionTextSelected]}>{opt.text}</Text>
              <View style={[styles.checkbox, isOn && styles.checkboxSelected]}>
                {isOn && <Text style={styles.checkboxMark}>✓</Text>}
              </View>
            </Pressable>
            {isOn && opt.id !== '__other__' && opt.script ? (
              <View style={styles.scriptBlock}>
                <Text style={styles.scriptLabel}>Read aloud</Text>
                <Text style={styles.scriptText}>{fill(opt.script)}</Text>
              </View>
            ) : null}
            {isOn && opt.id === '__other__' ? (
              <FreeText value={otherText} onChange={onOtherText} placeholder="Please specify" />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function FreeText({ value, onChange, placeholder }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TextInput
      value={value || ''}
      onChangeText={onChange}
      placeholder={placeholder || 'Type response'}
      placeholderTextColor={colors.textMuted}
      multiline
      style={styles.textInput}
    />
  );
}

// A statement or a closing block: read-aloud text in the house amber, captioned with what it is
// and, when the author named it, its title ("Closing · Close 2"). The body is 18/26 on both
// presentations, read at arm's length; newlines in it are the author's paragraphs. `text` is the
// block's label, already filled.
const StatementBlock = ({ block, text }) => {
  const styles = useThemedStyles(makeStyles);
  const title = typeof block.title === 'string' ? block.title.trim() : '';
  const caption = isClosingBlock(block) ? 'Closing' : 'Read aloud';
  return (
    <View style={[styles.scriptBlock, styles.inStack]}>
      <Text style={styles.scriptLabel}>{title ? `${caption} · ${title}` : caption}</Text>
      <Text style={styles.scriptBody}>{text}</Text>
    </View>
  );
};

// A question card. On the single page it is the card it has always been, its badge numbered over
// the visible questions only (a statement takes no number). One block per screen drops the badge,
// since the progress caption carries "Question N", and sets the question in 18px. The label is
// never filled: it is snapshotted onto every stored answer, so the server refuses `{{` in it.
const QuestionCard = ({ q, number, large, value, onChange, otherText, onOtherText, fill }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const selectMode =
    q.type === 'single_choice'
      ? '(Select one)'
      : q.type === 'multiple_choice'
      ? '(Select all that apply)'
      : '';
  return (
    <View style={styles.questionCard}>
      <View style={styles.questionHeader}>
        {large ? null : (
          <View style={styles.questionBadge}>
            <Text style={styles.questionBadgeText}>{number}</Text>
          </View>
        )}
        <Text style={[styles.questionLabel, large && styles.questionLabelLarge]}>
          {q.label}
          {q.required && <Text style={{ color: colors.brand }}> *</Text>}
        </Text>
        {selectMode ? (
          <Text style={styles.questionMode}>{selectMode}</Text>
        ) : null}
      </View>
      {q.type === 'single_choice' && (
        <SingleChoice
          q={q}
          value={value}
          onChange={onChange}
          otherText={otherText}
          onOtherText={onOtherText}
          fill={fill}
        />
      )}
      {q.type === 'multiple_choice' && (
        <MultipleChoice
          q={q}
          value={value}
          onChange={onChange}
          otherText={otherText}
          onOtherText={onOtherText}
          fill={fill}
        />
      )}
      {q.type === 'text' && <FreeText value={value} onChange={onChange} />}
    </View>
  );
};

// The form. `survey` is the template to walk; the host renders this only once it has one. The card
// at the top reads `title` (the voter's name, or "Practice run"), `subtitle` under it (the door's
// address, or a line saying nothing is saved; null for none) and `badge`: 'door' is the green
// At Door tag, 'practice' the info-tinted Practice tag, never green or amber (green means at a
// door, amber means read aloud). `saveLabel` names the Save button; `isSubmitting` holds it
// disabled with a spinner. `onSave({ answers, note })` receives the POST rows and the trimmed note
// (or null), and only once every visible required question is answered.
const SurveyForm = ({
  survey,
  canvasserFirstName,
  title,
  subtitle = null,
  badge = 'door',
  saveLabel = 'Save Response',
  isSubmitting = false,
  onSave,
}) => {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets(); // edges={['top']} omits bottom; the step footer clears it

  const [answers, setAnswers] = useState({});
  const [otherTexts, setOtherTexts] = useState({});
  const [note, setNote] = useState('');
  // One block per screen: the cursor is a screen id (the opening, a block key, or the end), held
  // here rather than as a route per block, so the stack depth the door's dismiss(2) relies on
  // never changes. It is never trusted as stored: every read goes through clampScreenId (below).
  const [cursor, setCursor] = useState(null);
  const stepAtRef = useRef(0);
  // The single page's scroll-to-reveal bookkeeping. Refs, not state: none of it is drawn.
  const scrollRef = useRef(null);
  const scrollYRef = useRef(0);
  const viewportHRef = useRef(0);
  const blockYRef = useRef({}); // block key → y of its row in the scroll content
  const shownKeysRef = useRef(null); // the visible keys at the last diff; null = no diff yet
  const revealKeyRef = useRef(null); // a block waiting for its first layout to be revealed

  // Live visibility: the blocks (questions and statements) that show for the answers so far, in
  // list order. lib/surveyRunner.js runs the shared evaluator over the template's stored
  // visibleIf, the same thing the server re-runs at save, so the phone and the server can never
  // disagree about what a canvasser was shown; "then go to" routes were compiled into visibleIf
  // when the survey was saved. A block that goes hidden keeps its answer in state (changing the
  // earlier answer back restores it) but is withheld from later rules and never posted.
  const visible = useMemo(() => visibleBlocks(survey, answers), [survey, answers]);

  // ---- One block per screen (presentation 'steps', PROPOSAL_SURVEY_SCRIPT_FLOW §H2) ----
  // The builder sets it on scripted surveys; every other survey keeps the single page. The door's
  // do-not-contact wall and not-found screen never mount the form, so Back stays plain there.
  const stepped = survey.presentation === 'steps';
  // The screen on display: the cursor while it is still a screen for these answers, else the
  // screen before its place (a template refresh can retire or hide the block under it). The cursor
  // then follows it, in RENDER (never an effect) so no answer change can land in between: left on
  // the vanished block, the next answer would be measured from there, and any screen that answer
  // revealed in between would take over. clampScreenId keeps a screen it returns, so one extra
  // pass settles it. A tap only changes the answer on the current screen, and a block's
  // visibility depends only on EARLIER answers, so a canvasser's own tap never moves this.
  const screenId = stepped ? clampScreenId(survey, answers, cursor) : null;
  if (stepped && cursor !== screenId) setCursor(screenId);

  // Every step goes through here: it stamps the double-tap guard and drops the keyboard, whose
  // text box leaves with the screen.
  const stepTo = useCallback((nextId) => {
    stepAtRef.current = Date.now();
    Keyboard.dismiss();
    setCursor(nextId);
  }, []);

  // Back, for the header and Android's back button. true = handled (stepped back, or swallowed the
  // second half of a double-tap); false = this is the first screen, so the caller leaves the
  // survey exactly as Back always has.
  const stepBack = useCallback(() => {
    if (!stepped) return false;
    if (justStepped(stepAtRef)) return true;
    const prev = prevScreenId(survey, answers, screenId);
    if (prev == null) return false;
    stepTo(prev);
    return true;
  }, [stepped, survey, answers, screenId, stepTo]);

  // Android's hardware back steps back too. Registered on focus, so it is live only while this
  // screen is on top, and removed through the subscription it returns. Returning false on the
  // first screen lets the stack pop the route, as today. (iOS has no hardware back; its swipe
  // pops the route and discards the form, as it always has.)
  useFocusEffect(
    useCallback(() => {
      if (!stepped) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', stepBack);
      return () => sub.remove();
    }, [stepped, stepBack])
  );

  // Each screen starts at its top: one ScrollView serves every screen, and a long statement read
  // to its end would otherwise hand that offset to the next screen.
  useEffect(() => {
    if (stepped) scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [stepped, screenId]);

  // ---- The single page: scroll a block a tap revealed into view (PROPOSAL_SURVEY_SCRIPT_FLOW §H3) ----
  // Scripted surveys only (see REVEAL_FOLD): every other survey keeps the page it has always had.
  const reveals = !stepped && isScripted(survey);
  // Called from the visibility diff below AND from the block's own onLayout, whichever comes
  // second: layout events and effects have no fixed order, and a just-mounted block has no y
  // until its layout lands.
  const revealBlock = useCallback((key) => {
    const y = blockYRef.current[key];
    if (y == null) return; // not laid out yet; its onLayout calls back
    revealKeyRef.current = null;
    const height = viewportHRef.current;
    if (!height || y < scrollYRef.current + height * REVEAL_FOLD) return; // already in view
    scrollRef.current?.scrollTo({ y: Math.max(0, y - height * REVEAL_AT), animated: true });
  }, []);

  useEffect(() => {
    revealKeyRef.current = null; // a newer change supersedes a reveal still waiting on layout
    if (!reveals) {
      // No single page on screen, or one that never scrolls on its own: start over from the next
      // page that does.
      shownKeysRef.current = null;
      blockYRef.current = {};
      return;
    }
    const keys = visible.map((q) => q.key);
    const before = shownKeysRef.current;
    shownKeysRef.current = new Set(keys);
    if (!before) return; // the page's first render revealed nothing
    // A block that hid has unmounted; forget its y so its return can't read a stale one.
    for (const k of before) if (!shownKeysRef.current.has(k)) delete blockYRef.current[k];
    const first = keys.find((k) => !before.has(k));
    // Never move the page under someone typing: the keyboard already decides what is on screen.
    if (!first || TextInput.State?.currentlyFocusedInput?.()) return;
    revealKeyRef.current = first;
    revealBlock(first);
  }, [reveals, visible, revealBlock]);

  function setAnswer(key, value) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  function setOtherText(key, value) {
    setOtherTexts((prev) => ({ ...prev, [key]: value }));
  }

  // The first visible required question still unanswered. The runner decides "answered" (an
  // Other pick counts once its typed text is non-blank) and skips statements, which never block
  // Save. On one block per screen Save only shows at the end of a complete path, so there the
  // alert below is the backstop for a template refresh that lands between a render and the tap.
  const pending = requiredPending(visible, answers, otherTexts);

  function validate() {
    return pending ? `Please answer: ${pending.label}` : null;
  }

  // {{canvasser}} reads as the signed-in canvasser's first name, in script text only: the
  // greeting, the closings, statements, answer scripts and notes. Never in a question's label or
  // an answer's text, which are stored with every response (lib/surveyScriptText.js).
  const fill = (text) => fillScript(text, { canvasserFirstName });

  // Numbers and progress run over the visible ANSWERABLE questions: a statement takes no number
  // and never counts toward progress.
  const numbers = questionNumbers(visible);
  const prog = progress(visible, answers, otherTexts);

  // Save, as far as the form goes: the required check first, with its Missing answer alert, then
  // the host's onSave with the POST rows and the note. The host does the rest: the door latches
  // against a double tap and submits; practice says nothing was saved.
  const onSubmit = () => {
    const err = validate();
    if (err) {
      Alert.alert('Missing answer', err);
      return;
    }
    onSave({
      // One row per visible ANSWERABLE question, shaped exactly as before (ids, the '__other__'
      // sentinel, a text snapshot). A statement never posts a row: the old inline map posted an
      // empty one per visible block. Hidden questions' answers stay behind in state, unposted.
      answers: buildSubmitRows(visible, answers, otherTexts),
      note: note.trim() || null,
    });
  };

  // ---- Pieces both presentations draw ----

  // One block: a statement's amber read-aloud box or a question card, then the canvasser's note
  // and links beneath it (nothing when the block has neither).
  const renderBlock = (q) => (
    <>
      {isStatement(q) ? (
        <StatementBlock block={q} text={fill(q.label)} />
      ) : (
        <QuestionCard
          q={q}
          number={numbers.get(q.key)}
          large={stepped}
          value={answers[q.key]}
          onChange={(v) => setAnswer(q.key, v)}
          otherText={otherTexts[q.key]}
          onOtherText={(t) => setOtherText(q.key, t)}
          fill={fill}
        />
      )}
      <SurveyNoteAndLinks note={fill(q.note)} links={q.links} />
    </>
  );

  const noteField = (
    <>
      <Text style={styles.noteLabel}>Note (optional)</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Anything worth remembering"
        placeholderTextColor={colors.textMuted}
        multiline
        style={styles.textInput}
      />
    </>
  );

  // Save: at the end of the single page, or in the step footer on the last screen, where it
  // shares the double-tap guard.
  const onSavePress = () => {
    if (stepped && justStepped(stepAtRef)) return;
    onSubmit();
  };
  const saveButton = (
    <Pressable
      onPress={onSavePress}
      disabled={isSubmitting}
      style={({ pressed }) => [
        styles.submitButton,
        stepped && styles.footerButton,
        { opacity: isSubmitting ? 0.6 : pressed ? 0.85 : 1 },
      ]}
    >
      {isSubmitting ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.submitButtonText}>{saveLabel}</Text>
      )}
    </Pressable>
  );

  // ---- One block per screen: the screen on display and its controls ----
  const stepScreen = stepped ? screens(survey, answers).find((s) => s.id === screenId) : null;
  const stepKind = screenKind(stepScreen);
  // The LAST screen carries Note and Save: the end screen, or a closing that is the last visible
  // block. A closing with a block still visible after it (Close 2 before Close 4) has Next.
  const onSaveScreen = stepped && screenId === saveScreenId(survey, answers);
  const nextOk = stepped && canAdvance(survey, answers, otherTexts, screenId);
  const skipOk = stepped && canSkip(survey, answers, screenId);

  // Header Back: the previous screen on the stepper. On the first screen, and on the single
  // page, it leaves the survey, as it always has.
  const onBack = () => {
    if (!stepBack()) router.back();
  };

  // A tap on an answer only SELECTS it (its read-aloud line and the Other box have to stay on
  // screen); Next advances. It is disabled on a blank required question, and re-checked here in
  // case a press lands on a stale render.
  const onNext = () => {
    if (justStepped(stepAtRef) || !canAdvance(survey, answers, otherTexts, screenId)) return;
    const next = nextScreenId(survey, answers, screenId);
    if (next) stepTo(next);
  };

  // Skip, on optional questions only, discards the answer and advances, which is how it differs
  // from Next when a value is present. The next screen comes from the answers Skip is about to
  // store, never from this render's list: clearing an answer can hide the blocks after it.
  const onSkip = () => {
    if (justStepped(stepAtRef) || !canSkip(survey, answers, screenId)) return;
    const skipped = skipAnswer(answers, otherTexts, screenId);
    setAnswers(skipped.answers);
    setOtherTexts(skipped.otherTexts);
    const next = nextScreenId(survey, skipped.answers, screenId);
    if (next) stepTo(next);
  };

  // The last screen's backstop. Next never passes a blank required question, so this shows only
  // when a template refresh mid-walk left one behind the cursor: Save gives way to a jump to it.
  const onJumpToPending = () => {
    if (justStepped(stepAtRef) || !pending) return;
    stepTo(pending.key);
  };

  // The single page records where each block row sits, for the scroll-to-reveal above.
  const onBlockLayout = (key, e) => {
    blockYRef.current[key] = e.nativeEvent.layout.y;
    if (revealKeyRef.current === key) revealBlock(key);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          // The single page ends on Save; the stepper's controls sit in the footer below.
          paddingBottom: stepped ? spacing.lg : 40,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onLayout={(e) => {
          viewportHRef.current = e.nativeEvent.layout.height;
        }}
        onScroll={(e) => {
          scrollYRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        {/* Header card: the voter at a door, or a practice run, whose tag wears the info tint
            instead of At Door's green so practice can never pass for a real door. */}
        <View style={styles.voterHeader}>
          <View style={styles.voterAvatar}>
            <Text style={styles.voterAvatarText}>
              {title
                .split(' ')
                .map((s) => s[0])
                .filter(Boolean)
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.voterName}>{title}</Text>
            {subtitle ? (
              <Text style={styles.voterAddress} numberOfLines={2}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {badge === 'practice' ? (
            <View style={[styles.atDoorPill, styles.practicePill]}>
              <View style={[styles.atDoorDot, styles.practiceDot]} />
              <Text style={[styles.atDoorText, styles.practiceText]}>Practice</Text>
            </View>
          ) : (
            <View style={styles.atDoorPill}>
              <View style={styles.atDoorDot} />
              <Text style={styles.atDoorText}>At Door</Text>
            </View>
          )}
        </View>

        {/* Progress, over the visible questions that record an answer. One block per screen has
            no "of M" (a path's length is not known until it is walked) and names the question
            only on a question screen; the row keeps its height so the bar never jumps. */}
        {stepped ? (
          <View style={styles.stepProgressRow}>
            {stepKind === 'question' ? (
              <Text style={styles.progressLeftText}>Question {numbers.get(screenId)}</Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.progressRow}>
            <Text style={styles.progressLeftText}>
              Question {Math.min(prog.answered + 1, prog.total)} of{' '}
              {prog.total}
            </Text>
            <Text style={styles.progressRightText}>{prog.percent}% Complete</Text>
          </View>
        )}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${prog.percent}%` }]} />
        </View>

        {stepped ? (
          // One screen: the opening, one block, or the end. Keyed by screen so each one mounts
          // fresh, with no press state or focus carried over from the last.
          <View key={screenId}>
            {stepKind === 'intro' ? (
              <View style={styles.scriptBlock}>
                <Text style={styles.scriptLabel}>Greeting</Text>
                <Text style={styles.scriptBody}>{fill(survey.intro)}</Text>
              </View>
            ) : null}

            {stepScreen?.block ? (
              <View style={styles.blockStack}>{renderBlock(stepScreen.block)}</View>
            ) : null}

            {/* The end screen follows a path that did not finish on a closing block: the
                survey's default closing when it applies, else just the word that it is over. */}
            {stepKind === 'end' ? (
              showDefaultClosing(survey, visible, answers, otherTexts) ? (
                <View style={styles.scriptBlock}>
                  <Text style={styles.scriptLabel}>Closing</Text>
                  <Text style={styles.scriptBody}>{fill(survey.closing)}</Text>
                </View>
              ) : (
                <Text style={styles.doneText}>Done — end of the survey.</Text>
              )
            ) : null}

            {onSaveScreen ? noteField : null}
          </View>
        ) : (
          <>
            {survey.intro ? (
              <View style={styles.scriptBlock}>
                <Text style={styles.scriptLabel}>Greeting</Text>
                <Text style={styles.scriptText}>{fill(survey.intro)}</Text>
              </View>
            ) : null}

            {/* Each block row is a direct child of the scroll content, so its onLayout y is
                the scroll offset the reveal needs. */}
            {visible.map((q) => (
              <View key={q.key} style={styles.blockStack} onLayout={(e) => onBlockLayout(q.key, e)}>
                {renderBlock(q)}
              </View>
            ))}

            {/* The default closing. An ordinary survey shows it whenever it has text, as always;
                a scripted one hides it under an explicit closing block and holds it until every
                visible required question is answered, so nobody reads the goodbye above a
                question they are still asking (lib/surveyRunner.js showDefaultClosing). */}
            {showDefaultClosing(survey, visible, answers, otherTexts) ? (
              <View style={styles.scriptBlock}>
                <Text style={styles.scriptLabel}>Closing</Text>
                <Text style={styles.scriptText}>{fill(survey.closing)}</Text>
              </View>
            ) : null}

            {noteField}

            {saveButton}
          </>
        )}
      </ScrollView>

      {/* One block per screen: Next / Skip, or Save on the last screen, docked under the scroll
          and inside the KeyboardAvoidingView, so the keyboard never covers them. */}
      {stepped ? (
        <View style={[styles.stepFooter, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          {onSaveScreen ? (
            pending ? (
              <Pressable
                onPress={onJumpToPending}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.stepButton,
                  styles.stepButtonSecondary,
                  pressed && styles.stepButtonPressed,
                ]}
              >
                <Text style={styles.stepButtonSecondaryText}>
                  Answer Question {numbers.get(pending.key)} to finish
                </Text>
              </Pressable>
            ) : (
              saveButton
            )
          ) : (
            <>
              {skipOk ? (
                <Pressable
                  onPress={onSkip}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.stepButton,
                    styles.stepButtonSecondary,
                    pressed && styles.stepButtonPressed,
                  ]}
                >
                  <Text style={styles.stepButtonSecondaryText}>Skip</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={onNext}
                disabled={!nextOk}
                accessibilityRole="button"
                accessibilityState={{ disabled: !nextOk }}
                style={({ pressed }) => [
                  styles.stepButton,
                  styles.stepButtonNext,
                  !nextOk && styles.stepButtonDisabled,
                  pressed && nextOk && styles.stepButtonPressed,
                ]}
              >
                <Text style={styles.submitButtonText}>Next</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default SurveyForm;

// A full-screen message with a Back button, for when there is no form to show: the door's
// do-not-contact wall (with its red title) and not-found screen, and a practice survey that is no
// longer on the phone.
export const SurveyWall = ({ title = null, message }) => {
  const router = useRouter();
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <SafeAreaView style={styles.center} edges={['top']}>
      {title ? <Text style={[type.h2, { color: colors.danger }]}>{title}</Text> : null}
      <Text style={title ? [type.body, { marginTop: spacing.sm, textAlign: 'center' }] : type.body}>
        {message}
      </Text>
      <Pressable onPress={() => router.back()} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>Back</Text>
      </Pressable>
    </SafeAreaView>
  );
};

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  back: { color: colors.brand, fontWeight: '700', fontSize: 16 },

  voterHeader: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  voterAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voterAvatarText: {
    color: colors.brand,
    fontWeight: '800',
    fontSize: 18,
  },
  voterName: { ...type.h2, fontSize: 18 },
  voterAddress: {
    ...type.caption,
    marginTop: 2,
    lineHeight: 18,
  },
  atDoorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successBg,
    borderColor: colors.successBorder,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  atDoorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
    marginRight: 6,
  },
  atDoorText: { color: colors.success, fontWeight: '700', fontSize: 11 },
  // Practice wears the info tint over the At Door pill's shape: never green (a real door) and
  // never amber (read aloud). infoFg on infoBg is 7.15:1 light, 8.63:1 dark.
  practicePill: { backgroundColor: colors.infoBg, borderColor: colors.info },
  practiceDot: { backgroundColor: colors.info },
  practiceText: { color: colors.infoFg },

  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  progressLeftText: {
    ...type.caption,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  progressRightText: {
    ...type.caption,
    color: colors.textSecondary,
  },
  progressBar: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
  },
  // One block per screen: the caption row holds its height on screens with no caption.
  stepProgressRow: {
    minHeight: 18,
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },

  scriptBlock: {
    backgroundColor: colors.warnBg,
    borderLeftWidth: 4,
    borderLeftColor: colors.warn,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  scriptLabel: {
    ...type.micro,
    color: colors.warnFg,
    marginBottom: 6,
  },
  scriptText: { fontSize: 14, color: colors.warnFg, lineHeight: 20 },
  // A statement's or closing's body: read at arm's length, so larger than an answer's script.
  scriptBody: { fontSize: 18, color: colors.warnFg, lineHeight: 26 },
  // A block inside blockStack, which owns the spacing below the block.
  inStack: { marginBottom: 0 },

  // One block and its note/links: the block, then what it carries for the canvasser beneath it.
  // The bottom margin is the gap the question card used to carry, so a plain survey's cards sit
  // exactly as far apart as before.
  blockStack: {
    marginBottom: spacing.md,
    gap: spacing.sm,
  },

  questionCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  questionBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionBadgeText: {
    color: colors.textInverse,
    fontWeight: '800',
    fontSize: 13,
  },
  questionLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  // One block per screen: the question alone on its screen, asked at arm's length.
  questionLabelLarge: { fontSize: 18, lineHeight: 26 },
  questionMode: {
    color: colors.textMuted,
    fontSize: 12,
  },

  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  // Wraps a single option Pressable + its inline read-aloud script / Other input.
  // Carries the grid sizing so the option keeps its two-up layout; the script and
  // FreeText stack full-width beneath it.
  optionWrap: {
    minWidth: '47%',
    flexGrow: 1,
  },
  option: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionSelected: {
    backgroundColor: colors.brandTint,
    borderColor: colors.brand,
  },
  optionText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  optionTextSelected: {
    color: colors.brand,
    fontWeight: '700',
  },

  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  radioSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textInverse,
  },

  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  checkboxSelected: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  checkboxMark: { color: colors.textInverse, fontWeight: '900', fontSize: 12 },

  noteLabel: {
    ...type.h3,
    fontSize: 14,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  textInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
    color: colors.textPrimary,
  },
  submitButton: {
    backgroundColor: colors.brand,
    paddingVertical: spacing.md + 4,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  submitButtonText: {
    color: colors.textInverse,
    fontWeight: '800',
    fontSize: 16,
  },

  // One block per screen. The end screen's word when no default closing applies.
  doneText: {
    ...type.caption,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  // The step footer: the app's docked-bar idiom (card + top rule, as admin/audit.jsx's bulkBar
  // and admin/books.jsx's actionBar), in the flow under the scroll rather than absolute, so the
  // KeyboardAvoidingView lifts it over the keyboard. The bottom inset is added inline.
  stepFooter: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  // Same geometry as the Save button, so Next and Save land in the same place on every screen.
  stepButton: {
    flex: 1,
    backgroundColor: colors.brand,
    paddingVertical: spacing.md + 4,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonNext: { flex: 2 },
  // Skip, and the jump back to an unanswered question: an action, not the way forward.
  stepButtonSecondary: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  stepButtonSecondaryText: {
    color: colors.brand,
    fontWeight: '800',
    fontSize: 16,
    textAlign: 'center',
  },
  stepButtonDisabled: { opacity: 0.5 },
  stepButtonPressed: { opacity: 0.85 },
  // Save in the footer: the row sets its place, not the single page's top margin.
  footerButton: { flex: 1, marginTop: 0 },

  primaryButton: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  primaryButtonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
  });
}
