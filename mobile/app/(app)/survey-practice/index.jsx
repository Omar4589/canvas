import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import InsetGroup, { InsetNavRow, GroupFooter } from '../../../components/InsetGroup';
import SectionHeader from '../../../components/SectionHeader';
import { SurveyWall } from '../../../components/SurveyForm';
import { practiceSurveys } from '../../../lib/doorSurvey';
import { spacing } from '../../../lib/theme';
import { useThemedStyles } from '../../../lib/useThemedStyles';

// Practice the survey, when the user's walk lists use more than one survey: which one to rehearse
// (docs/PROPOSAL_SURVEY_PRACTICE.md). The canvasser menu opens the run directly when there is only
// one, so this list is normally reached with two or more; it reads the same entries the menu
// counted (lib/doorSurvey.js practiceSurveys), named by walk list, with the survey's own name under
// each. A tap opens the run in ./[surveyId].jsx. Nothing here is saved.
const SurveyPracticeList = () => {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  // Pure reader, like the door screen: the menu offers practice only while the bundle is cached.
  const { data: bootstrap } = useQuery({ queryKey: ['bootstrap'], refetchOnMount: false });
  const entries = practiceSurveys(bootstrap);

  if (!entries.length) {
    return <SurveyWall message="There's no survey to practice on this campaign right now." />;
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Practice the survey
        </Text>
        <View style={{ width: 64 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
      >
        <SectionHeader caption title="Your walk lists" />
        <InsetGroup>
          {entries.map((e) => (
            <InsetNavRow
              key={e.id}
              label={e.label}
              sub={e.survey.name}
              onPress={() => router.push(`/(app)/survey-practice/${e.id}`)}
            />
          ))}
        </InsetGroup>
        <GroupFooter>
          Your walk lists use different surveys. Pick one to rehearse it exactly as it looks at a
          door. Nothing you enter is saved.
        </GroupFooter>
      </ScrollView>
    </SafeAreaView>
  );
};

export default SurveyPracticeList;

const makeStyles = (t) => {
  const { colors, type } = t;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    back: { color: colors.brand, fontWeight: '700', fontSize: 16, width: 64 },
    headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },
  });
};
