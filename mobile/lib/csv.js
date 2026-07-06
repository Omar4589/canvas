// The main expo-file-system entry (v19+) throws on the legacy functions and no
// longer exports cacheDirectory/EncodingType — the legacy subpath keeps them.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import { API_BASE_URL } from './config';
import { getToken } from './auth';
import { loadActiveOrgId } from './cache';

// Fetch a CSV from the backend (using the same auth/org headers as api()),
// write it to a file in the app cache, then open the OS share sheet.
//
// path: absolute backend path including query string (e.g. "/admin/reports/canvassers.csv?from=...")
// filename: suggested filename for the user (e.g. "canvassers-2026-05-12.csv")
export async function downloadCsv(path, filename) {
  try {
    const token = await getToken();
    const orgId = await loadActiveOrgId();
    const headers = { Accept: 'text/csv' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (orgId) headers['X-Org-Id'] = orgId;

    const res = await fetch(`${API_BASE_URL}/api${path}`, { headers });
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status}`);
    }
    const text = await res.text();

    // Best-effort sweep of OLD exports so they don't pile up in the cache dir.
    // Age-gated (>1h) rather than "all but the current file": a just-created
    // export from a moment ago may still be held by a share target reading it
    // lazily (e.g. Gmail attaching on Android), so never delete a fresh one.
    try {
      const cutoff = Date.now() / 1000 - 60 * 60;
      const names = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory);
      await Promise.all(
        names
          .filter((n) => n.toLowerCase().endsWith('.csv'))
          .map(async (n) => {
            const uri = `${FileSystem.cacheDirectory}${n}`;
            const info = await FileSystem.getInfoAsync(uri);
            if (info.exists && info.modificationTime && info.modificationTime < cutoff) {
              await FileSystem.deleteAsync(uri, { idempotent: true });
            }
          })
          .map((p) => p.catch(() => {}))
      );
    } catch {
      // cache listing is non-essential
    }

    const uri = `${FileSystem.cacheDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(uri, text, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'text/csv',
        UTI: 'public.comma-separated-values-text',
        dialogTitle: 'Export CSV',
      });
    } else {
      Alert.alert('Saved', `CSV saved to ${uri}`);
    }
    return uri;
  } catch (err) {
    Alert.alert('Export failed', err.message || 'Could not export CSV');
    throw err;
  }
}
