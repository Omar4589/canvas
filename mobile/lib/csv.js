import * as FileSystem from 'expo-file-system';
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
