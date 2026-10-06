import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { shouldConfirmResurvey, buildResurveyPrompt } from '../../../../lib/resurvey';
import { changePrompt, buildChangePrompt } from '../../../../lib/doorChange';
import { surveyPath } from '../../../../lib/doorPaths';
import { surveyForDoor } from '../../../../lib/doorSurvey';
import { optimisticSubmit } from '../../../../lib/recordAction';
import SurveyForm, { SurveyWall } from '../../../../components/SurveyForm';
import { useTheme } from '../../../../lib/ThemeContext';

// The survey at a door. This screen owns the VOTER: which survey the door uses, the prompts before
// the form, the do-not-contact wall, and the save. The form itself (every block, both
// presentations, Note and Save) is components/SurveyForm.jsx, which Practice the survey walks too,
// saving nothing (docs/PROPOSAL_SURVEY_PRACTICE.md).

export default function VoterSurvey() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { colors } = useTheme();

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
  // falling back to the campaign default (activeSurvey). lib/doorSurvey.js owns the rule, so
  // Practice the survey offers exactly the survey this door uses.
  const survey = useMemo(() => surveyForDoor(bootstrap, household), [bootstrap, household]);

  // Guard against a double-tap on Save creating two survey responses. firedRef blocks the second
  // call synchronously (state updates are async); isSubmitting drives the disabled/spinner UI.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const firedRef = useRef(false);
  const resurveyPromptedRef = useRef(false);
  // The door-change check runs ONCE, the first time the door is known — never later, when a
  // teammate's delta could otherwise pop it up in the middle of a survey.
  const doorCheckedRef = useRef(false);

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

  // Do-not-contact wall: the server 403s the submit anyway — this is the
  // courteous version, before any answers get typed. After the hooks above so
  // the hook order stays stable.
  if (voter?.dnc) {
    return (
      <SurveyWall
        title="Do not contact"
        message={
          'This voter has asked not to be contacted.\nThe survey is disabled for them. If ' +
          'everyone at this address is flagged, the door will drop off your list automatically.'
        }
      />
    );
  }

  if (!voter || !survey) {
    return <SurveyWall message={!voter ? 'Voter not found.' : 'No active survey configured.'} />;
  }

  // Gate-then-optimistic: optimisticSubmit first acquires the GPS stamp (no location =
  // no survey), then marks the voter surveyed + recolors the household and fires
  // onAccepted — where we jump back to the map. The network write stays in the
  // background so the canvasser never waits on it.
  // The form has already run the required check (SurveyForm's Save), so this is the save itself.
  const onSave = ({ answers, note }) => {
    if (firedRef.current) return; // double-tap: the first submit is already in flight
    firedRef.current = true;
    setIsSubmitting(true);

    optimisticSubmit(qc, {
      path: surveyPath(id),
      body: {
        surveyTemplateId: survey._id,
        // The form's POST rows (buildSubmitRows: one per visible ANSWERABLE question) and the
        // trimmed note, or null.
        answers,
        note,
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
  };

  return (
    <SurveyForm
      survey={survey}
      canvasserFirstName={bootstrap?.user?.firstName}
      title={voter.fullName}
      subtitle={
        household ? (
          <>
            {household.addressLine1}
            {'\n'}
            {household.city}, {household.state} {household.zipCode}
          </>
        ) : null
      }
      badge="door"
      saveLabel="Save Response"
      isSubmitting={isSubmitting}
      onSave={onSave}
    />
  );
}
