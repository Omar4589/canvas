// The main expo-file-system entry (v19+) throws on the legacy functions and no
// longer exports cacheDirectory — the legacy subpath keeps them (same note as csv.js).
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import { API_BASE_URL } from './config';
import { getToken } from './auth';
import { loadActiveOrgId } from './cache';

// Download a finished Export Center artifact (CSV or ZIP) straight to a FILE and hand it
// to the OS share sheet. Deliberately NOT lib/csv.js's fetch→text→write flow: an artifact
// can be tens of MB and a ZIP is binary — downloadAsync streams to disk without ever
// holding the body in JS memory, and is byte-safe for both content types.
//
// path: backend path (e.g. "/admin/exports/<id>/download"); filename: suggested name
// (from the ExportJob doc); mimeType: 'text/csv' | 'application/zip'.
export async function downloadArtifact(path, filename, mimeType = 'text/csv') {
  try {
    const token = await getToken();
    const orgId = await loadActiveOrgId();
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (orgId) headers['X-Org-Id'] = orgId;

    const safeName = String(filename || 'export.csv').replace(/[^a-zA-Z0-9._-]+/g, '_');
    const uri = `${FileSystem.cacheDirectory}${safeName}`;
    const res = await FileSystem.downloadAsync(`${API_BASE_URL}/api${path}`, uri, { headers });
    if (res.status !== 200) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      throw new Error(
        res.status === 410
          ? 'This export has expired — queue a fresh one.'
          : `Download failed: ${res.status}`
      );
    }

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType,
        ...(mimeType === 'application/zip'
          ? { UTI: 'public.zip-archive' }
          : { UTI: 'public.comma-separated-values-text' }),
        dialogTitle: 'Export',
      });
    } else {
      Alert.alert('Saved', `Saved to app storage as ${safeName}`);
    }
    return uri;
  } catch (err) {
    Alert.alert('Download failed', err?.message || 'Could not download the export.');
    throw err;
  }
}
