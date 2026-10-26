// The Client Reports intro and its How it works guide, in ONE place (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md
// §B, Part 1 §1): the page header and the guide read these, and the Help Center's client-reports
// articles quote them word for word — change the words here and there together.

/** The page's one-line description, under its title; "How it works" follows it as a text link. */
export const INTRO =
  'Make reports for your client here. Each one shows the campaign’s running totals and what was added in the dates you pick. Share it with a link and its password, or download a PDF.';

export const HOW_IT_WORKS_LINK = 'How it works';
export const GUIDE_TITLE = 'How client reports work';

/** The three steps. `title` reads bold, then " — " and `body`. */
export const STEPS = [
  {
    title: 'Make a report',
    body: 'press New report and pick the dates, usually Last week. After that, Next report on your newest report makes the following one in one click, with your settings and notes copied.',
  },
  {
    title: 'Check it, then publish',
    body: 'the preview is exactly what your client will see. Once it’s published, its numbers stay as they are until you press Refresh numbers.',
  },
  {
    title: 'Share it',
    body: 'Share gives you a message with the link to paste into your email or text; send the link’s password separately. Or open the report and press Download PDF.',
  },
];

/** Phones (below 640 px) get these short lines instead, and no Help line. */
export const PHONE_STEPS = ['Make a report — usually Last week; then Next report each week.', 'Check the preview, then publish.', 'Share the link; send its password separately.'];

export const HELP_LINE = 'More in the Help Center →';
export const HELP_PATH = '/help/client-reports';
export const GOT_IT = 'Got it';
