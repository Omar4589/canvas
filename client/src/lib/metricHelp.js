// Short "(i)" tooltip copy for the canvasser metrics, shared by the campaign home
// StatCards and the CanvasserSummaryTable column headers so every count reads the
// same everywhere. Wording mirrors reportDerive.js's KPI_HELP — by HAND, not by import, so a
// reworded sentence has to be carried across both files (and mobile/lib/metricHelp.js) deliberately.
export const metricHelp = {
  doors:
    'Doors knocked in the selected range — one per house, per pass. If two canvassers knock the same house in the same pass it counts ONCE for the campaign (though it shows on both their rows). Going back in a later pass counts again.',
  surveyDoors:
    'Doors where at least one survey was taken — one per house, per pass. This is what the connection rate divides by. It is usually lower than "Voters surveyed", because one house can have several voters.',
  // ONE key for one metric. There were briefly two (`surveyedVoters` + `votersSurveyed`) with
  // different wording, consumed by different components — which is precisely the drift this module
  // exists to prevent.
  surveyedVoters:
    'Distinct people surveyed — counted once each, however many passes you surveyed them in. Not how many forms were filled out. One house can have several voters, so this is usually higher than "Survey doors".',
  // The THIRD unit. Door-unit and voter-unit alone couldn't describe a row count, so row counts got
  // labelled "Voters surveyed" all over the app — correct only while a campaign has one pass,
  // because one response per voter per pass makes rows and people the same number. Go back for a
  // second pass and they part company.
  surveysTaken:
    'How many surveys were filled out. Survey the same person again in a later pass and that is another survey — so this can be higher than "Voters surveyed", which counts each person once.',
  // `litDrops` describes litKnocks — the DOOR count, one per house per pass — and is what the
  // lit rate divides. `litDropEvents` describes litDropped, the raw number of drop actions,
  // which is higher wherever one door was lit twice in a pass. They are different server
  // fields and must never share a help string. Mirrored in mobile/lib/metricHelp.js.
  litDrops: 'Doors where literature was dropped, counted once per door per pass.',
  litDropEvents:
    'How many times literature was dropped. Drop at the same door twice in one pass and that is two drops — so this can exceed the number of doors, and it is NOT what the lit rate divides by.',
  connectionRate:
    'Of the doors knocked, the share that completed the goal — a survey submitted OR a lit drop. (A lit drop counts even if no one answered.)',
  contactRate:
    'Of the doors knocked, the share where someone answered — a completed survey OR a refusal. (A refusal counts here but not toward connection rate.)',
  // Was "measured from the first knock to the last" — which described a CALENDAR span and
  // under-reported pace roughly threefold over a multi-day range (737 doors over 6 days read 4.9/hr
  // instead of 13.7). It is the sum of each DAY's working span.
  doorsPerHour:
    "Doors knocked per hour actively on doors — each day's first knock to its last knock, added up. Time between days is not counted.",
  coordinator:
    'The team this canvasser\'s doors count toward — whoever their coordinator is now. Change someone\'s coordinator and their earlier doors move with them; someone leaving moves nothing. "Multiple" means they knocked for more than one team in this range.',
  start: 'The first door this canvasser knocked in the range.',
  lastDoor: 'The most recent door this canvasser knocked in the range.',
  households: 'Distinct homes reached at least once (a home counts once no matter how many passes).',
  activeCanvassers:
    'People who recorded at least one door in the selected range — not everyone assigned to a campaign. Someone assigned but not out yet does not appear here.',
  restricted:
    'Inaccessible homes — a locked building, a gate, no legal access. Recorded and shown, but never counted as a knock and never billed.',
  noSoliciting:
    'Homes where a posted no-soliciting sign ended the visit. The canvasser reached the door, so these ARE knocks and count toward doors/hour — but nobody answered, so they never count toward the contact rate.',
};
