import AsyncStorage from '@react-native-async-storage/async-storage';
// The main expo-file-system entry (v19+) throws on the legacy functions and no
// longer exports documentDirectory — the legacy subpath keeps them.
import * as FileSystem from 'expo-file-system/legacy';

// Legacy AsyncStorage key for the bootstrap — kept only so startup can migrate
// the old row into the file and delete it (see the chain seed below). The
// bootstrap now lives in a file: on Android, AsyncStorage is SQLite with a
// ~2MB per-row read limit (CursorWindow) and a ~6MB total-DB cap, so a large
// turf's bootstrap crashed with "Row too big" / SQLITE_FULL. Files have
// neither limit; iOS was always file-backed and unaffected.
const KEY = 'canvass.bootstrap';
// The bootstrap lives in the OS CACHE directory, deliberately: iOS excludes Library/Caches
// from iCloud/device backups, and Android's auto-backup rules exclude cache/ — so the voter
// roster (names, addresses, coordinates, party) never rides into a canvasser's PERSONAL
// cloud backup. Documents/ — the old home — is backed up by default on both platforms, which
// put voter PII in iCloud/Google accounts we don't control. The trade-off is that the OS may
// evict caches under severe disk pressure; that's acceptable because this file is a cache of
// server state and the app re-bootstraps on the next online session. Do NOT move it back to
// documentDirectory — the privacy policy's device-storage disclosure depends on this.
const LEGACY_BOOTSTRAP_FILE = `${FileSystem.documentDirectory}canvass.bootstrap.json`;
const BOOTSTRAP_FILE = `${FileSystem.cacheDirectory}canvass.bootstrap.json`;
// writeAsStringAsync truncates the target in place, so a process kill mid-write
// would leave a corrupt file where SQLite's row write was transactional. Saves
// write here first, then moveAsync (a rename) over the real file — the cache is
// always either the previous snapshot or the new one, never a partial.
const BOOTSTRAP_TMP = `${BOOTSTRAP_FILE}.tmp`;
const CAMPAIGN_KEY = 'canvass.activeCampaign';
const USER_KEY = 'canvass.currentUser';
const MEMBERSHIPS_KEY = 'canvass.memberships';
const ACTIVE_ORG_KEY = 'canvass.activeOrgId';
const ACTIVE_ORG_NAME_KEY = 'canvass.activeOrgName';
const SELECTED_BOOKS_KEY = 'canvass.selectedBooks';
const CURRENT_EFFORT_KEY = 'canvass.currentEffort';
const VIEW_MODE_KEY = 'canvass.viewMode';
const MAP_STYLE_KEY = 'canvass.mapStyle';
const SERVER_META_KEY = 'canvass.serverMeta';
const THEME_KEY = 'canvass.themePreference';

// Serialize every bootstrap file op (mirrors offlineQueue's withQueueLock).
// Three writers interleave — the bootstrap fetch, the 30s changes poll, and
// recordAction's fire-and-forget optimistic save — and file ops give no
// cross-call ordering guarantee, so an unserialized load could race a write.
// The chain is seeded with a one-time migration of the legacy AsyncStorage
// row: a readable row (iOS, or a normal-sized Android one) is copied into the
// file so the update never costs anyone their offline cache; the oversized
// Android rows this rewrite exists for throw on getItem (CursorWindow), land
// in the catch, and are deleted unread — removeItem never reads the row, so
// it can't throw, and it's what frees Android's 6MB AsyncStorage DB.
let bootstrapChain = (async () => {
  // Migration 2: the file used to live in Documents/, which both platforms back up to the
  // canvasser's personal cloud account. Move it into Caches/ (excluded from backups) so
  // nobody loses their offline roster on update — and so the Documents copy stops existing.
  try {
    const old = await FileSystem.getInfoAsync(LEGACY_BOOTSTRAP_FILE);
    if (old.exists) {
      const current = await FileSystem.getInfoAsync(BOOTSTRAP_FILE);
      if (!current.exists) {
        await FileSystem.moveAsync({ from: LEGACY_BOOTSTRAP_FILE, to: BOOTSTRAP_FILE });
      } else {
        await FileSystem.deleteAsync(LEGACY_BOOTSTRAP_FILE, { idempotent: true });
      }
    }
  } catch {
    // Best-effort — worst case the next save writes the new location and the stale
    // Documents copy is deleted by the retry below on the following launch.
  }
  // Migration 1: the even older AsyncStorage row (see the CursorWindow note above).
  try {
    const legacy = await AsyncStorage.getItem(KEY);
    if (legacy) {
      const info = await FileSystem.getInfoAsync(BOOTSTRAP_FILE);
      if (!info.exists) {
        await FileSystem.writeAsStringAsync(BOOTSTRAP_TMP, legacy);
        await FileSystem.moveAsync({ from: BOOTSTRAP_TMP, to: BOOTSTRAP_FILE });
      }
    }
    await AsyncStorage.removeItem(KEY);
  } catch {
    await AsyncStorage.removeItem(KEY).catch(() => {});
  }
})();
function withBootstrapLock(fn) {
  const run = bootstrapChain.then(fn, fn);
  bootstrapChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

// Coalescing: rapid saves (a knock burst, a delta landing beside a fetch) each
// used to serialize + write the full multi-MB blob back-to-back. Instead, the
// newest snapshot is parked in `pendingSave` and one queued writer drains it —
// N calls while a write is queued collapse into that one write of the newest
// data, so a caller's resolved save always means "your data or newer is on
// disk", and loads/clears never wait behind a stack of superseded writes.
let pendingSave = null;
let queuedSave = null;

// Best-effort by design: a failed cache write must never fail the data path —
// the map/books queryFns call this right after a successful fetch, and the
// delta poll + recordAction call it fire-and-forget with no catch of their own.
export function saveBootstrap(data) {
  pendingSave = { ...data, cachedAt: new Date().toISOString() };
  if (queuedSave) return queuedSave;
  queuedSave = withBootstrapLock(async () => {
    queuedSave = null; // saves arriving once this write starts queue a fresh one
    const snapshot = pendingSave;
    pendingSave = null;
    try {
      await FileSystem.writeAsStringAsync(BOOTSTRAP_TMP, JSON.stringify(snapshot));
      await FileSystem.moveAsync({ from: BOOTSTRAP_TMP, to: BOOTSTRAP_FILE });
    } catch (err) {
      console.warn('saveBootstrap failed', err);
    }
  });
  return queuedSave;
}

export function loadBootstrap() {
  return withBootstrapLock(async () => {
    try {
      const raw = await FileSystem.readAsStringAsync(BOOTSTRAP_FILE);
      return JSON.parse(raw);
    } catch {
      // Missing file, read error, or corrupt JSON — same contract as before:
      // no cache. Callers fall back to fetching.
      return null;
    }
  });
}

// Swallows errors: logout runs this inside a Promise.all that must not abort.
// Deletes the legacy Documents copy AND the tmp file too — sign-out must leave voter data in
// NO location, and a crash between writeAsStringAsync and moveAsync can strand a full roster
// copy in the tmp path that nothing else would ever clean up.
export function clearBootstrap() {
  return withBootstrapLock(async () => {
    try {
      await FileSystem.deleteAsync(BOOTSTRAP_FILE, { idempotent: true });
      await FileSystem.deleteAsync(BOOTSTRAP_TMP, { idempotent: true });
      await FileSystem.deleteAsync(LEGACY_BOOTSTRAP_FILE, { idempotent: true });
    } catch (err) {
      console.warn('clearBootstrap failed', err);
    }
  });
}

export async function saveActiveCampaign(campaign) {
  if (!campaign) {
    await AsyncStorage.removeItem(CAMPAIGN_KEY);
    return;
  }
  await AsyncStorage.setItem(CAMPAIGN_KEY, JSON.stringify(campaign));
}

export async function loadActiveCampaign() {
  const raw = await AsyncStorage.getItem(CAMPAIGN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearActiveCampaign() {
  await AsyncStorage.removeItem(CAMPAIGN_KEY);
}

export async function saveCurrentUser(user) {
  if (!user) {
    await AsyncStorage.removeItem(USER_KEY);
    return;
  }
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function loadCurrentUser() {
  const raw = await AsyncStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearCurrentUser() {
  await AsyncStorage.removeItem(USER_KEY);
}

export async function saveMemberships(memberships) {
  if (!memberships) {
    await AsyncStorage.removeItem(MEMBERSHIPS_KEY);
    return;
  }
  await AsyncStorage.setItem(MEMBERSHIPS_KEY, JSON.stringify(memberships));
}

export async function loadMemberships() {
  const raw = await AsyncStorage.getItem(MEMBERSHIPS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function clearMemberships() {
  await AsyncStorage.removeItem(MEMBERSHIPS_KEY);
}

export async function saveActiveOrgId(orgId) {
  if (!orgId) {
    await AsyncStorage.removeItem(ACTIVE_ORG_KEY);
    return;
  }
  await AsyncStorage.setItem(ACTIVE_ORG_KEY, String(orgId));
}

export async function loadActiveOrgId() {
  return AsyncStorage.getItem(ACTIVE_ORG_KEY);
}

// The active org's display name, cached alongside its id when the user picks an
// org — so surfaces like the drawer can show it without relying on a membership
// record (super admins enter orgs they aren't members of).
export async function saveActiveOrgName(name) {
  if (!name) {
    await AsyncStorage.removeItem(ACTIVE_ORG_NAME_KEY);
    return;
  }
  await AsyncStorage.setItem(ACTIVE_ORG_NAME_KEY, String(name));
}

export async function loadActiveOrgName() {
  return AsyncStorage.getItem(ACTIVE_ORG_NAME_KEY);
}

export async function clearActiveOrgId() {
  await AsyncStorage.removeItem(ACTIVE_ORG_KEY);
  await AsyncStorage.removeItem(ACTIVE_ORG_NAME_KEY);
}

// Which book(s) the canvasser is currently working. Persisted so the map can
// re-scope to the last selection on cold start instead of falling open to all
// houses. Scoped to a campaign so a stale book never leaks across campaigns —
// `books` is the comma-joinable id string the map's `selectedBooks` param uses,
// so single- and (future) multi-select share one storage shape.
export async function saveSelectedBooks(campaignId, books) {
  if (!campaignId || !books) {
    await AsyncStorage.removeItem(SELECTED_BOOKS_KEY);
    return;
  }
  await AsyncStorage.setItem(
    SELECTED_BOOKS_KEY,
    JSON.stringify({ campaignId: String(campaignId), books: String(books) })
  );
}

export async function loadSelectedBooks(campaignId) {
  const raw = await AsyncStorage.getItem(SELECTED_BOOKS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Ignore a selection saved under a different campaign.
    if (String(parsed.campaignId) !== String(campaignId)) return null;
    return parsed.books || null;
  } catch {
    return null;
  }
}

export async function clearSelectedBooks() {
  await AsyncStorage.removeItem(SELECTED_BOOKS_KEY);
}

// Which effort the canvasser is currently working. Book numbers restart per
// effort, so a canvasser on two efforts could see two "Book 6"s — this scopes
// the Books picker to one effort at a time. Scoped to a campaign so a stale
// effort never leaks across campaigns.
export async function saveCurrentEffort(campaignId, effortId) {
  if (!campaignId || !effortId) {
    await AsyncStorage.removeItem(CURRENT_EFFORT_KEY);
    return;
  }
  await AsyncStorage.setItem(
    CURRENT_EFFORT_KEY,
    JSON.stringify({ campaignId: String(campaignId), effortId: String(effortId) })
  );
}

export async function loadCurrentEffort(campaignId) {
  const raw = await AsyncStorage.getItem(CURRENT_EFFORT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (String(parsed.campaignId) !== String(campaignId)) return null;
    return parsed.effortId || null;
  } catch {
    return null;
  }
}

export async function clearCurrentEffort() {
  await AsyncStorage.removeItem(CURRENT_EFFORT_KEY);
}

// Whether the door-working screen opens as a 'map' or a 'list'. Scoped to a
// campaign (mirrors saveSelectedBooks) so it never leaks across campaigns.
export async function saveViewMode(campaignId, mode) {
  if (!campaignId || !mode) {
    await AsyncStorage.removeItem(VIEW_MODE_KEY);
    return;
  }
  await AsyncStorage.setItem(
    VIEW_MODE_KEY,
    JSON.stringify({ campaignId: String(campaignId), mode: String(mode) })
  );
}

export async function loadViewMode(campaignId) {
  const raw = await AsyncStorage.getItem(VIEW_MODE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (String(parsed.campaignId) !== String(campaignId)) return null;
    return parsed.mode === 'list' ? 'list' : 'map';
  } catch {
    return null;
  }
}

// Which base map style the user last picked (id from lib/mapStyles). Persisted
// globally (not per-campaign) so the map opens on their preferred style. Street
// is the default; satellite/hybrid are heavier on data + battery, so they only
// apply when the user opts in.
export async function saveMapStyle(styleId) {
  if (!styleId) {
    await AsyncStorage.removeItem(MAP_STYLE_KEY);
    return;
  }
  await AsyncStorage.setItem(MAP_STYLE_KEY, String(styleId));
}

export async function loadMapStyle() {
  return AsyncStorage.getItem(MAP_STYLE_KEY);
}

// Small bag of server-reported facts the app needs before/independent of any
// org-scoped call — currently just `minClientApiVersion`, the lowest client
// contract version the server still accepts. Saved at login (and refreshable
// from any response that includes it) so the routing layer can gate a too-old
// bundle on cold start, not only right after login.
export async function saveServerMeta(meta) {
  if (!meta) {
    await AsyncStorage.removeItem(SERVER_META_KEY);
    return;
  }
  await AsyncStorage.setItem(SERVER_META_KEY, JSON.stringify(meta));
}

export async function loadServerMeta() {
  const raw = await AsyncStorage.getItem(SERVER_META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Light/dark preference: 'light' | 'dark' | 'system'. 'system' (follow the OS)
// is the default, so it's stored as the absence of the key — saving 'system'
// removes it, and a missing key reads back as null which the ThemeProvider
// treats as 'system'.
export async function saveThemePreference(pref) {
  if (!pref || pref === 'system') {
    await AsyncStorage.removeItem(THEME_KEY);
    return;
  }
  await AsyncStorage.setItem(THEME_KEY, String(pref));
}

export async function loadThemePreference() {
  return AsyncStorage.getItem(THEME_KEY);
}
