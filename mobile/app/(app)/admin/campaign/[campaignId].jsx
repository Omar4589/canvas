import { useLocalSearchParams } from 'expo-router';
import CampaignHome from '../../../../components/CampaignHome';

// One campaign's admin screen, opened from a campaign row (the Overview, its Archived list). The
// screen itself lives in components/CampaignHome.jsx, because the Overview tab also renders it —
// embedded — for a team lead with exactly one active campaign.
//
// key={campaignId} is load-bearing. This is a hidden TAB, and expo-router turns a push into a navigate
// between tabs, keeping the same route instance with new params — so without the key the walk-list,
// crew and pass choices made on one campaign carried into the next one opened (a campaign could read
// zero because of a walk list picked on another).
const CampaignScreen = () => {
  const { campaignId } = useLocalSearchParams();
  const cId = Array.isArray(campaignId) ? campaignId[0] : campaignId;
  return <CampaignHome key={cId} campaignId={cId} />;
};

export default CampaignScreen;
