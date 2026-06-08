// Per-share unlock token (issued after a correct share-link password). Kept in sessionStorage so it
// lasts for the browser tab only — closing the tab requires re-entering the password.
const keyFor = (token) => `doorline.share.${token}`;

export function getShareAccess(token) {
  try {
    return sessionStorage.getItem(keyFor(token)) || null;
  } catch {
    return null;
  }
}

export function setShareAccess(token, accessToken) {
  try {
    if (accessToken) sessionStorage.setItem(keyFor(token), accessToken);
    else sessionStorage.removeItem(keyFor(token));
  } catch {
    /* ignore */
  }
}
