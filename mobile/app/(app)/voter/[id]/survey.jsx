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
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { shouldConfirmResurvey, buildResurveyPrompt } from '../../../../lib/resurvey';
import { changePrompt, buildChangePrompt } from '../../../../lib/doorChange';
import { surveyPath } from '../../../../lib/doorPaths';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { optimisticSubmit } from '../../../../lib/recordAction';
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
} from '../../../../lib/surveyRunner';
import { fillScript } from '../../../../lib/surveyScriptText';
import SurveyNoteAndLinks from '../../../../components/SurveyNoteAndLinks';
import { radius, spacing } from '../../../../lib/theme';
import { useTheme } from '../../../../lib/ThemeContext';
import { useThemedStyles } from '../../../../lib/useThemedStyles';

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

export default function VoterSurvey() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets(); // edges={['top']} omits bottom; the step footer clears it

  // Pure reader (see household/[id].jsx): no auto-refetch on mount, so a stale
  // bootstrap fetch can't revert the optimistic recolor after a survey submit.
  const { data: bootstrap } = useQuery({ queryKey: ['bootstrap'], refetchOnMount: false });
  const voter = (bootstrap?.voters || []).find((v) => String(v._id) === String(id));
  const household = useMemo(
    () =>
      (bootstrap?.households || []).find(
        (h) => String(h._id) === String(voter?.householdId)
      ),
    [bootstrap, voter]
  );
  // Per-effort survey: resolve via the door's book → effort survey override,
  // falling back to the campaign default (activeSurvey).
  const survey = useMemo(() => {
    const books = bootstrap?.books || [];
    const surveys = bootstrap?.surveys || {};
    const book = household?.turfId
      ? books.find((b) => String(b.id) === String(household.turfId))
      : null;
    const sid = book?.surveyTemplateId;
    return (sid && surveys[String(sid)]) || bootstrap?.activeSurvey || null;
  }, [bootstrap, household]);

  const [answers, setAnswers] = useState({});
  const [otherTexts, setOtherTexts] = useState({});
  const [note, setNote] = useState('');
  // Guard against a double-tap on Save creating two survey responses. firedRef blocks the second
  // call synchronously (state updates are async); isSubmitting drives the disabled/spinner UI.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const firedRef = useRef(false);
  const resurveyPromptedRef = useRef(false);
  // The door-change check runs ONCE, the first time the door is known — never later, when a
  // teammate's delta could otherwise pop it up in the middle of a survey.
  const doorCheckedRef = useRef(false);
  // One block per screen: the cursor is a screen id (the opening, a block key, or the end), held
  // here rather than as a route per block, so the stack depth dismiss(2) relies on never changes.
  // It is never trusted as stored: every read goes through clampScreenId (below).
  const [cursor, setCursor] = useState(null);
  const stepAtRef = useRef(0);
  // The single page's scroll-to-reveal bookkeeping. Refs, not state: none of it is drawn.
  const scrollRef = useRef(null);
  const scrollYRef = useRef(0);
  const viewportHRef = useRef(0);
  const blockYRef = useRef({}); // block key → y of its row in the scroll content
  const shownKeysRef = useRef(null); // the visible keys at the last diff; null = no diff yet
  const revealKeyRef = useRef(null); // a block waiting for its first layout to be revealed

  // Smart re-survey confirm — at mount, before any answer is entered, once per visit. Fires
  // ONLY when a TEAMMATE surveyed this voter this round (surveyedByMe === false); an own
  // re-survey stays the one-tap self-heal, and an absent flag (old cache/server) fails open —
  // the server preserves the replaced response either way, so a missed confirm loses nothing.
  // Declared with the other hooks, before the DNC early return, and skips DNC voters (that
  // wall renders instead — the two alerts must never stack).
  //
  // The same mount check also asks before CHANGING the door's result (lib/doorChange.js, owner
  // ruling 2026-10-02): a door already marked Not home, Refused, … this round gets "Take a survey
  // instead?". One prompt per visit, whichever applies — the two never stack, and the DNC wall
  // suppresses both. Here, on the survey screen, it covers every way into a survey: Take survey,
  // Re-survey, and Add person → Add & take survey — before any answer is entered.
  useEffect(() => {
    if (resurveyPromptedRef.current) return;
    if (!voter || voter.dnc) return;
    if (shouldConfirmResurvey(voter)) {
      resurveyPromptedRef.current = true;
      const p = buildResurveyPrompt();
      Alert.alert(p.title, p.message, [
        { text: p.cancelText, style: 'cancel', onPress: () => router.back() },
        { text: p.confirmText }, // default style — proceeding is legitimate, not destructive
      ]);
      return;
    }
    if (doorCheckedRef.current || !household) return;
    doorCheckedRef.current = true;
    const prompt = changePrompt({ door: household, action: 'survey_submitted' });
    if (!prompt) return;
    resurveyPromptedRef.current = true;
    const w = buildChangePrompt(prompt, colors.statusLabels);
    Alert.alert(w.title, w.message, [
      { text: w.cancelText, style: 'cancel', onPress: () => router.back() },
      { text: w.confirmText },
    ]);
  }, [voter, household, router, colors]);

  // Live visibility: the blocks (questions and statements) that show for the answers so far, in
  // list order. lib/surveyRunner.js runs the shared evaluator over the template's stored
  // visibleIf, the same thing the server re-runs at save, so the phone and the server can never
  // disagree about what a canvasser was shown; "then go to" routes were compiled into visibleIf
  // when the survey was saved. A block that goes hidden keeps its answer in state (changing the
  // earlier answer back restores it) but is withheld from later rules and never posted. Declared
  // before the early return so the hook order stays stable regardless of voter/survey availability.
  const visible = useMemo(() => (survey ? visibleBlocks(survey, answers) : []), [survey, answers]);

  // ---- One block per screen (presentation 'steps', PROPOSAL §H2) ----
  // The builder sets it on scripted surveys; every other survey keeps the single page. Never
  // while the do-not-contact wall or the not-found screen shows, so Back stays plain there.
  const formShown = !!voter && !voter.dnc && !!survey;
  const stepped = formShown && survey.presentation === 'steps';
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

  // ---- The single page: scroll a block a tap revealed into view (PROPOSAL §H3) ----
  // Scripted surveys only (see REVEAL_FOLD): every other survey keeps the page it has always had.
  const reveals = formShown && !stepped && isScripted(survey);
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

  // Do-not-contact wall: the server 403s the submit anyway — this is the
  // courteous version, before any answers get typed. After the hooks above so
  // the hook order stays stable.
  if (voter?.dnc) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={[type.h2, { color: colors.danger }]}>Do not contact</Text>
        <Text style={[type.body, { marginTop: spacing.sm, textAlign: 'center' }]}>
          This voter has asked not to be contacted.{'\n'}The survey is disabled
          for them. If everyone at this address is flagged, the door will drop
          off your list automatically.
        </Text>
        <Pressable onPress={() => router.back()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!voter || !survey) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={type.body}>
          {!voter ? 'Voter not found.' : 'No active survey configured.'}
        </Text>
        <Pressable onPress={() => router.back()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

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
  const fill = (text) => fillScript(text, { canvasserFirstName: bootstrap?.user?.firstName });

  // Numbers and progress run over the visible ANSWERABLE questions: a statement takes no number
  // and never counts toward progress.
  const numbers = questionNumbers(visible);
  const prog = progress(visible, answers, otherTexts);

  // Gate-then-optimistic: optimisticSubmit first acquires the GPS stamp (no location =
  // no survey), then marks the voter surveyed + recolors the household and fires
  // onAccepted — where we jump back to the map. The network write stays in the
  // background so the canvasser never waits on it.
  function onSubmit() {
    const err = validate();
    if (err) {
      Alert.alert('Missing answer', err);
      return;
    }
    if (firedRef.current) return; // double-tap: the first submit is already in flight
    firedRef.current = true;
    setIsSubmitting(true);

    optimisticSubmit(qc, {
      path: surveyPath(id),
      body: {
        surveyTemplateId: survey._id,
        // One row per visible ANSWERABLE question, shaped exactly as before (ids, the '__other__'
        // sentinel, a text snapshot). A statement never posts a row: the old inline map posted an
        // empty one per visible block. Hidden questions' answers stay behind in state, unposted.
        answers: buildSubmitRows(visible, answers, otherTexts),
        note: note.trim() || null,
      },
      optimisticPatch: (prev) => ({
        ...prev,
        voters: prev.voters.map((v) =>
          // surveyedByMe:true so a same-session return reads as an OWN re-survey (one tap),
          // not a false teammate confirm; the next delta confirms it with server truth.
          String(v._id) === String(id) ? { ...v, surveyStatus: 'surveyed', surveyedByMe: true } : v
        ),
        households: prev.households.map((h) =>
          String(h._id) === String(voter.householdId)
            // restrictedFrom cleared, never inherited: a stale 'desk' would let the change
            // confirmation skip this door later (lib/doorChange.js).
            ? { ...h, status: 'surveyed', restrictedFrom: null, lastActionAt: new Date().toISOString() }
            : h
        ),
      }),
      pending: [{ id: voter.householdId, status: 'surveyed' }],
      // Refresh the canvasser's Today's Progress counts (Responses/Remaining) on submit.
      invalidateKeys: [['mobile', 'me']],
      reconcile: (prev, response) => {
        const status = response?.household?.status;
        if (!status) return prev;
        return {
          ...prev,
          households: prev.households.map((h) =>
            String(h._id) === String(voter.householdId) ? { ...h, status } : h
          ),
        };
      },
      hardFailTitle: 'Survey not saved',
      hardFailMessage: 'Could not save this survey. Please try again.',
      // Navigate only once the location gate passes and the optimistic patch lands;
      // a blocked gate keeps the canvasser here with the form intact. dismiss(2), not
      // replace: replace swapped only THIS route, so every survey left its household
      // and a fresh param-less map screen mounted in the stack — dozens of live
      // Mapbox views by end of shift, and an edge-swipe could resurface a map still
      // scoped to an earlier book. Popping survey + household returns to the screen
      // the door was opened from (map, or a building's unit list) with its params
      // untouched — dismissTo would REWRITE the map's params from the bare href
      // (StackRouter POP_TO without merge), wiping selectedBooks; a plain POP can't.
      onAccepted: () => router.dismiss(2),
    })
      .then((res) => {
        if (res?.duplicate) {
          // A submit for this voter is still in flight — and it carries the EARLIER
          // tap's answers, not this form. Never imply these answers were captured:
          // once that submit settles, Save again re-submits (the legal re-survey /
          // overwrite path), so the honest guidance is wait-then-retry.
          Alert.alert(
            'Still saving an earlier response',
            'An earlier response for this voter is still saving, so these answers are not saved yet. Wait a moment, then tap Save again.'
          );
        }
      })
      // Every settle releases the latch: on success the screen already navigated
      // away at onAccepted (release is a no-op there), and blocked/duplicate/error
      // must re-enable Save — one release site instead of one per branch.
      .finally(() => {
        firedRef.current = false;
        setIsSubmitting(false);
      });
  }

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
        <Text style={styles.submitButtonText}>Save Response</Text>
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
        {/* Voter header card */}
        <View style={styles.voterHeader}>
          <View style={styles.voterAvatar}>
            <Text style={styles.voterAvatarText}>
              {voter.fullName
                .split(' ')
                .map((s) => s[0])
                .filter(Boolean)
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.voterName}>{voter.fullName}</Text>
            {household && (
              <Text style={styles.voterAddress} numberOfLines={2}>
                {household.addressLine1}
                {'\n'}
                {household.city}, {household.state} {household.zipCode}
              </Text>
            )}
          </View>
          <View style={styles.atDoorPill}>
            <View style={styles.atDoorDot} />
            <Text style={styles.atDoorText}>At Door</Text>
          </View>
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
}

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
