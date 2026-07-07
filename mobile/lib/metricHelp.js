// Short "(i)" info-popup copy for the canvasser metrics, shared by the campaign
// detail tiles and the CanvasserCard. Kept in sync with client/src/lib/metricHelp.js
// so web and mobile read the same explanations.
export const metricHelp = {
  doors:
    'Doors knocked in the selected range — every knock action, counted once per house-pass. Going back in a later pass counts again.',
  surveys: 'Survey forms collected at the door — one per voter, so a two-voter home in one visit is two surveys.',
  surveyedVoters: 'Distinct voters who completed a survey — not how many forms were filled out.',
  litDrops: 'Doors where literature was dropped, counted once per door per pass.',
  connectionRate:
    'Of the doors knocked, the share that completed the goal — a survey submitted OR a lit drop. (A lit drop counts even if no one answered.)',
  contactRate:
    'Of the doors knocked, the share where someone answered — a completed survey OR a refusal. (A refusal counts here but not toward connection rate.)',
  doorsPerHour: 'Doors knocked per hour actively on doors — measured from the first knock to the last.',
  coordinator: 'The team lead overseeing this canvasser.',
  start: 'The first door this canvasser knocked in the range.',
  lastDoor: 'The most recent door this canvasser knocked in the range.',
  households: 'Distinct homes reached at least once (a home counts once no matter how many passes).',
};
