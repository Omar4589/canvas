import { useState } from 'react';
import { Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import SurveyForm, { SurveyWall } from '../../../components/SurveyForm';
import { practiceSurveys } from '../../../lib/doorSurvey';

// Practice the survey (docs/PROPOSAL_SURVEY_PRACTICE.md): the door's own survey form, walked with
// no voter and no save, so a canvasser can rehearse before knocking. Reached from the canvasser
// menu (components/CanvasserDrawer.jsx), directly or through the list in ./index.jsx.
//
// NOTHING here writes. This screen imports no recordAction, no API client and no cache writer:
// answers live in SurveyForm's state and are gone when the screen closes, so a practice run can
// never reach the server, the offline queue, a door's color or anyone's counts. It never asks for
// location either, because only a real save needs the GPS stamp. Keep it that way.
const SurveyPractice = () => {
  const router = useRouter();
  const { surveyId: rawSurveyId } = useLocalSearchParams();
  const surveyId = Array.isArray(rawSurveyId) ? rawSurveyId[0] : rawSurveyId;
  // Pure reader, like the door screen: the menu offers practice only while the bundle is cached,
  // and no refetch on mount.
  const { data: bootstrap } = useQuery({ queryKey: ['bootstrap'], refetchOnMount: false });
  // Only a survey this user can meet at a door (lib/doorSurvey.js), never an arbitrary id.
  const entry = practiceSurveys(bootstrap).find((e) => e.id === String(surveyId));
  // Practice again bumps this: a new key mounts a fresh form, on its first screen, with no answers.
  const [run, setRun] = useState(0);

  if (!entry) {
    // The survey was swapped or detached while this screen was open, or the campaign changed.
    return <SurveyWall message="This survey isn't available to practice any more." />;
  }

  const onFinish = () => {
    Alert.alert('Practice finished', 'Nothing was saved. At a real door, Save Response records the answers.', [
      { text: 'Practice again', onPress: () => setRun((n) => n + 1) },
      { text: 'Done', onPress: () => router.back() },
    ]);
  };

  return (
    <SurveyForm
      key={run}
      survey={entry.survey}
      canvasserFirstName={bootstrap?.user?.firstName}
      title="Practice run"
      subtitle="Nothing here is saved"
      badge="practice"
      saveLabel="Finish practice"
      onSave={onFinish}
    />
  );
};

export default SurveyPractice;
