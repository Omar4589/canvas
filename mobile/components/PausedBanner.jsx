import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { setPace } from '../lib/recordAction';
import { PACE_CHECK_FAILED, PACE_HELP_SLUG, PACE_MESSAGE } from '../lib/pace';
import { useFocusedPoll } from '../lib/useFocusedPoll';
import { guardedPush } from '../lib/navGuard';
import { useTheme } from '../lib/ThemeContext';

// "Recording is paused for review" (docs/PROPOSAL_PACE_PAUSE.md §E.4), on the map, door, building and survey
// screens, in the same soft-banner family as LocationBlockedBanner. `paused` is the screen's read of the
// cached state (lib/pace.js isPaused); nothing renders otherwise. While it shows, it polls GET /mobile/pace
// itself: the map's /changes poll stops whenever the map is covered (it stays mounted under the door and
// survey screens), and an unpause has to reach whichever screen is in front. The answer goes through setPace
// from inside the queryFn, so a cached answer is never re-applied. Check again asks now.
const rowStyle = (bg) => ({
  backgroundColor: bg,
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 7,
  marginHorizontal: 12,
  marginTop: 6,
});

const PausedBanner = ({ paused }) => {
  const qc = useQueryClient();
  const router = useRouter();
  const { colors } = useTheme();
  // Set by Check again, so its outcome is said; the background poll stays quiet when it fails.
  const [asked, setAsked] = useState(false);
  const q = useQuery({
    queryKey: ['mobile', 'pace'],
    queryFn: async () => {
      const answer = await api('/mobile/pace');
      setPace(qc, answer);
      return answer;
    },
    enabled: !!paused,
    refetchInterval: 30 * 1000,
    retry: false,
    ...useFocusedPoll(),
  });
  useEffect(() => {
    if (!paused) setAsked(false);
  }, [paused]);

  if (!paused) return null;
  const checking = q.isFetching && asked;
  const failed = asked && !q.isFetching && q.isError;
  const fg = colors.dangerFg;
  return (
    <View style={rowStyle(colors.dangerBg)} accessibilityRole="alert">
      <Text style={{ color: fg, fontSize: 13, fontWeight: '700' }}>{PACE_MESSAGE}</Text>
      {failed && <Text style={{ color: fg, fontSize: 12, marginTop: 2 }}>{PACE_CHECK_FAILED}</Text>}
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
        <Pressable
          onPress={() => {
            setAsked(true);
            q.refetch();
          }}
          disabled={checking}
          hitSlop={6}
          accessibilityRole="button"
        >
          <Text style={{ color: fg, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' }}>
            {checking ? 'Checking…' : 'Check again'}
          </Text>
        </Pressable>
        <Pressable onPress={() => guardedPush(router, `/(app)/help/${PACE_HELP_SLUG}`)} hitSlop={6} accessibilityRole="link">
          <Text style={{ color: fg, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' }}>What happened?</Text>
        </Pressable>
      </View>
    </View>
  );
};

export default PausedBanner;
