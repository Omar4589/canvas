// The Users list's one-time "Sam Rivera's account was deleted." The profile that deleted the account
// leaves it here and pops back; the list takes it when it regains focus. A module store because the
// two screens share no React tree to pass it through (supportAccessState.js has the same seam), and
// no subscribers: the list only ever reads it on focus. Pure, so deletionNotice.test.js runs in node.

let pending = null;

export const leaveDeletionNotice = (text) => {
  pending = text || null;
};

// The waiting notice, cleared as it is read, so it shows once.
export const takeDeletionNotice = () => {
  const text = pending;
  pending = null;
  return text;
};
