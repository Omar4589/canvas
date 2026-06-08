import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'canvass.bootstrap';
const CAMPAIGN_KEY = 'canvass.activeCampaign';
const USER_KEY = 'canvass.currentUser';
const MEMBERSHIPS_KEY = 'canvass.memberships';
const ACTIVE_ORG_KEY = 'canvass.activeOrgId';
const ACTIVE_ORG_NAME_KEY = 'canvass.activeOrgName';
const SELECTED_BOOKS_KEY = 'canvass.selectedBooks';
const CURRENT_EFFORT_KEY = 'canvass.currentEffort';
const MAP_STYLE_KEY = 'canvass.mapStyle';
const SERVER_META_KEY = 'canvass.serverMeta';
const THEME_KEY = 'canvass.themePreference';

export async function saveBootstrap(data) {
  await AsyncStorage.setItem(KEY, JSON.stringify({ ...data, cachedAt: new Date().toISOString() }));
}

export async function loadBootstrap() {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearBootstrap() {
  await AsyncStorage.removeItem(KEY);
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
