// Short "(i)" info-popup copy for the canvasser metrics, shared by the campaign
// detail tiles and the CanvasserCard. Kept in sync with client/src/lib/metricHelp.js
// so web and mobile read the same explanations.
export const metricHelp = {
  doors:
    'Doors knocked in the selected range — one per house, per pass. If two canvassers knock the same house in the same pass it counts ONCE for the campaign (though it shows on both their rows). Going back in a later pass counts again.',
  surveyDoors:
    'Doors where at least one survey was taken — one per house, per pass. This is what the connection rate divides by. It is usually lower than "Surveyed voters", because one house can have several voters.',
  surveyedVoters:
    'Distinct people surveyed — not how many forms were filled out. One house can have several voters, so this is usually higher than "Survey doors".',
  litDrops: 'Doors where literature was dropped, counted once per door per pass.',
  connectionRate:
    'Of the doors knocked, the share that completed the goal — a survey submitted OR a lit drop. (A lit drop counts even if no one answered.)',
  contactRate:
    'Of the doors knocked, the share where someone answered — a completed survey OR a refusal. (A refusal counts here but not toward connection rate.)',
  // Was "measured from the first knock to the last" — which described a CALENDAR span and
  // under-reported pace roughly threefold over a multi-day range. It is the sum of each DAY's
  // working span.
  doorsPerHour:
    "Doors knocked per hour actively on doors — each day's first knock to its last knock, added up. Time between days is not counted.",
  coordinator:
    'The team this canvasser\'s doors count toward — whoever their coordinator is now. Change someone\'s coordinator and their earlier doors move with them; someone leaving moves nothing.',
  start: 'The first door this canvasser knocked in the range.',
  lastDoor: 'The most recent door this canvasser knocked in the range.',
  households: 'Distinct homes reached at least once (a home counts once no matter how many passes).',
  restricted:
    'Inaccessible homes — a locked building, a gate, no legal access. Recorded and shown, but never counted as a knock and never billed.',
};
