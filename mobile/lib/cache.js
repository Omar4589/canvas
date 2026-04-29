import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'canvass.bootstrap';

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
