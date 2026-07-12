import { Text } from 'react-native';
import { voterMetaParts } from '../lib/voters';

// The one voter identity line a canvasser reads at a door: Party · Age · Gender.
// Both door surfaces (the map's house sheet and the household screen) render THIS —
// they used to compose their own lines and disagreed (age vs. precinct) for the same
// person out of the same cache. Returns null when a voter has none of the three, so a
// sparse import can never leave a dangling separator or an empty row.
// `style` is a passthrough so each host keeps its own type scale.
export default function VoterMeta({ voter, style, numberOfLines }) {
  const parts = voterMetaParts(voter);
  if (parts.length === 0) return null;
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.join(' · ')}
    </Text>
  );
}
