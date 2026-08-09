import { useNavigate } from 'react-router-dom';

// Click-anywhere-on-the-row/card navigation, shared so the card and table renderings of the same
// list cannot drift apart.
//
// This is a MOUSE affordance and deliberately not a tab stop. Every surface using it already
// contains a real <Link> to the same destination, which is what keyboard and screen-reader users
// use; adding role="link" + tabIndex to the container would only manufacture a second, redundant
// stop to the same URL. Wrapping the container in a real <a> is not an option either — these rows
// contain buttons and a kebab menu, and interactive elements cannot nest inside a link.
//
// Pair it with an onClick-stopping wrapper around the row's own controls (see
// shouldIgnoreRowClick's callers) so a button press never also navigates.
export function useRowNavigation(href) {
  const navigate = useNavigate();
  return (e) => {
    // A drag to select text ends in a click on the container — that is a selection, not a
    // navigation, and hijacking it makes the row's text impossible to copy.
    if (window.getSelection()?.toString()) return;
    // Honor the new-tab gesture the way the real links inside the row already do. Without this,
    // cmd-clicking a row would navigate the current tab — the opposite of what was asked for.
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    navigate(href);
  };
}

// Handler for the wrapper around a row's own controls. Its whole job is to keep a control's click
// from also reaching the row-navigation handler above. Applied to a WRAPPER rather than to each
// control so anything interactive added later is covered without remembering to annotate it.
export const stopRowClick = (e) => e.stopPropagation();
