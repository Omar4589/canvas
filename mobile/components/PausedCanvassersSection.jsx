import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatInTz } from '../lib/datetime';
import { spacing } from '../lib/theme';
import { usePausedList } from '../lib/pacePauses';
import { statusLine } from '../lib/pacePauseText';
import { useFocusedPoll } from '../lib/useFocusedPoll';
import InsetGroup, { InsetNavRow, InsetRow, InsetActionRow } from './InsetGroup';
import SectionHeader from './SectionHeader';

// The GPS audit's "Paused for review" section (docs/PROPOSAL_PACE_PAUSE.md §G.3): every open pause the viewer
// may see, across all their campaigns — not filtered by the campaign chip, which the More row's badge ignores
// too — naming the campaign, plus a team lead's roster lines (their canvasser paused on a campaign they don't
// manage: named, nothing more, and not openable). Renders nothing when nobody is paused, which is nearly always.
// It sits in the screen's fixed area, so it shows whatever the flag list below is doing; long lists fold to
// the first few.
const FOLD_AT = 3;

const PausedCanvassersSection = ({ live = true }) => {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  const q = usePausedList({ refetchInterval: live ? 20_000 : false, ...useFocusedPoll(20 * 1000) });
  const open = (q.data?.pauses || []).filter((p) => p.status === 'paused' && p.memberActive);
  const lines = q.data?.rosterLines || [];
  const rows = [
    ...open.map((p) => ({ kind: 'pause', key: p.id, p })),
    ...lines.map((l) => ({ kind: 'line', key: `line-${l.userId}`, l })),
  ];
  if (!rows.length) return null;
  const shown = showAll ? rows : rows.slice(0, FOLD_AT);
  return (
    <View>
      <SectionHeader title="Paused for review" />
      <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.sm }}>
        <InsetGroup>
          {shown.map((r) =>
            r.kind === 'pause' ? (
              <InsetNavRow
                key={r.key}
                label={r.p.name || 'A canvasser'}
                unit={r.p.campaignName || undefined}
                // An open pause that isn't blocking (automatic pause switched off) says so instead of the count.
                sub={
                  r.p.blocking
                    ? `Paused ${formatInTz(r.p.firedAt, r.p.timeZone)} · ${r.p.fails} ${r.p.fails === 1 ? 'door' : 'doors'} faster than possible`
                    : statusLine(r.p, r.p.timeZone)
                }
                badge={r.p.blocking ? { text: 'paused' } : null}
                onPress={() => router.push(`/(app)/admin/pause/${r.p.id}`)}
              />
            ) : (
              <InsetRow key={r.key} label={r.l.name || 'A canvasser'} sub="Paused for review — an org admin can unpause." badge={{ text: 'paused' }} />
            )
          )}
          {rows.length > FOLD_AT ? (
            <InsetActionRow label={showAll ? 'Show fewer' : `Show all ${rows.length}`} onPress={() => setShowAll((v) => !v)} />
          ) : null}
        </InsetGroup>
      </View>
    </View>
  );
};

export default PausedCanvassersSection;
