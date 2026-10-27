// The child process behind test/crewJobCrash.int.test.js: it runs one real crew change (or join) and
// kills itself at the named step, the way a dyno restart cuts a request off. Only the model method that
// step calls is wrapped, and only in this process, so the code under test is the code that ships.
//
//   CRASH_URI, CRASH_ORG, CRASH_CAMPAIGN, CRASH_USER, CRASH_TO (an id or ''), CRASH_FROM (an id or ''),
//   CRASH_ACTOR, CRASH_MODE ('change' | 'join'), CRASH_STEP:
//     claim          — the conditional updateOne that sets the crew and the job
//     first-ledger   — the CanvassActivity re-stamp (the renewal before it has run)
//     second-ledger  — the SurveyResponse re-stamp
//     record         — the CoordinatorChange write
//     release        — the $unset of the job
//
// Exits 0 if the step was never reached, so the test can tell "killed there" from "finished". Plain
// `node --test` also runs every .js file under test/, this one included: without CRASH_STEP it does
// nothing.
const env = process.env;

const run = async () => {
  const { default: mongoose } = await import('mongoose');
  const idOrNull = (v) => (v ? new mongoose.Types.ObjectId(v) : null);
  const { CampaignAssignment } = await import('../../src/models/CampaignAssignment.js');
  const { CanvassActivity } = await import('../../src/models/CanvassActivity.js');
  const { SurveyResponse } = await import('../../src/models/SurveyResponse.js');
  const { CoordinatorChange } = await import('../../src/models/CoordinatorChange.js');
  const { CREW_JOB, setMemberCoordinator, joinCampaignCrew } = await import('../../src/services/memberships/setCoordinator.js');

  const die = () => process.kill(process.pid, 'SIGKILL');
  const trap = (Model, method, when) => {
    const original = Model[method].bind(Model);
    Model[method] = (...args) => (when(...args) ? die() : original(...args));
  };
  const STEPS = {
    claim: () => trap(CampaignAssignment, 'updateOne', (_filter, update) => !!update?.$set?.crewJob),
    'first-ledger': () => trap(CanvassActivity, 'updateMany', () => true),
    'second-ledger': () => trap(SurveyResponse, 'updateMany', () => true),
    record: () => trap(CoordinatorChange, 'findOneAndUpdate', () => true),
    release: () => trap(CampaignAssignment, 'updateOne', (_filter, update) => !!update?.$unset && 'crewJob' in update.$unset),
  };
  if (!STEPS[env.CRASH_STEP]) throw new Error(`unknown CRASH_STEP ${env.CRASH_STEP}`);

  mongoose.set('strictQuery', true); // as production's connectDb
  await mongoose.connect(env.CRASH_URI);
  Object.assign(CREW_JOB, { secondPassMs: 20 });
  STEPS[env.CRASH_STEP]();

  const args = {
    organizationId: idOrNull(env.CRASH_ORG),
    campaignId: idOrNull(env.CRASH_CAMPAIGN),
    userId: idOrNull(env.CRASH_USER),
    coordinatorId: idOrNull(env.CRASH_TO),
    actorUserId: idOrNull(env.CRASH_ACTOR),
  };
  if (env.CRASH_MODE === 'join') {
    await joinCampaignCrew({ ...args, source: 'campaign_join' });
  } else {
    await setMemberCoordinator({ ...args, source: 'lead_crew', from: idOrNull(env.CRASH_FROM) });
  }
  await mongoose.disconnect();
};

if (env.CRASH_STEP) await run();
