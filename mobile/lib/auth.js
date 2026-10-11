import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'canvass.token';

export async function getToken() {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token) {
  if (token) {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // A delete that fails must not leave the signed-out person's token to be read back on the next
    // launch (lib/sessionStore.js clears memory regardless). Overwrite it with an empty string,
    // which reads back as "no token"; if that fails too, the error goes to the caller.
    await SecureStore.setItemAsync(TOKEN_KEY, '');
  }
}
