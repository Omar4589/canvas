// Which survey a door uses, and which surveys a canvasser can practice. ONE owner, read by the door
// (app/(app)/voter/[id]/survey.jsx) and by Practice the survey (app/(app)/survey-practice/, the
// canvasser menu's row; docs/PROPOSAL_SURVEY_PRACTICE.md), so a practice run can never show a
// different survey from the one at the door.
//
// Pure data in, data out: the bootstrap bundle, never a fetch. The bundle carries `books` (the
// user's own books in active rounds, each with `surveyTemplateId` already resolved by the server:
// the walk list's override, else the campaign default), `surveys` (every template those books name,
// plus the campaign default, keyed by id), `activeSurvey` (the campaign default) and `efforts` (the
// walk lists the user has books in). See canvasserBooks in server/src/routes/mobile/bootstrap.js.

// The survey a door in this book uses: the book's, when the phone holds it, else the campaign
// default. No book (or one that isn't the user's) also means the campaign default.
export const surveyForBook = (bootstrap, book) => {
  const surveys = bootstrap?.surveys || {};
  const sid = book?.surveyTemplateId;
  return (sid && surveys[String(sid)]) || bootstrap?.activeSurvey || null;
};

// The survey for a door, through the book that holds it (household.turfId).
export const surveyForDoor = (bootstrap, household) => {
  const books = bootstrap?.books || [];
  const book = household?.turfId
    ? books.find((b) => String(b.id) === String(household.turfId))
    : null;
  return surveyForBook(bootstrap, book);
};

const byText = (a, b) => a.localeCompare(b);

// What Practice the survey offers: one entry per distinct survey the user's books use, named by
// the walk lists that use it, sorted by that name. Before the user has any books, the campaign's
// survey alone. Nothing on a lit-drop campaign (its doors have no survey), and nothing when no
// survey resolves (the door would say "No active survey configured").
//   [{ id, survey, walkLists: string[], label }]
// `label` is the walk list names, or 'Campaign survey' when no named walk list uses it (books
// outside any walk list, or no books yet).
export const practiceSurveys = (bootstrap) => {
  if (!bootstrap || bootstrap.campaign?.type !== 'survey') return [];
  const walkListName = new Map((bootstrap.efforts || []).map((e) => [String(e.id), e.name]));
  const books = bootstrap.books || [];
  const entries = new Map(); // survey id → { id, survey, walkLists }
  const add = (survey, walkList) => {
    if (!survey || survey._id == null) return;
    const id = String(survey._id);
    if (!entries.has(id)) entries.set(id, { id, survey, walkLists: [] });
    const entry = entries.get(id);
    if (walkList && !entry.walkLists.includes(walkList)) entry.walkLists.push(walkList);
  };
  if (books.length) {
    for (const book of books) {
      add(surveyForBook(bootstrap, book), book.effortId ? walkListName.get(String(book.effortId)) : null);
    }
  } else {
    add(bootstrap.activeSurvey, null);
  }
  return [...entries.values()]
    .map((e) => {
      const walkLists = [...e.walkLists].sort(byText);
      return { ...e, walkLists, label: walkLists.length ? walkLists.join(', ') : 'Campaign survey' };
    })
    .sort((a, b) => byText(a.label, b.label));
};
