import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'canvass.bootstrap';
const CAMPAIGN_KEY = 'canvass.activeCampaign';
const USER_KEY = 'canvass.currentUser';
const MEMBERSHIPS_KEY = 'canvass.memberships';
const ACTIVE_ORG_KEY = 'canvass.activeOrgId';

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

export async function clearActiveOrgId() {
  await AsyncStorage.removeItem(ACTIVE_ORG_KEY);
}
