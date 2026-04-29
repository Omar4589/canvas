import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

const QUEUE_KEY = 'canvass.offlineQueue';

async function readQueue() {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeQueue(queue) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Enqueue a submission for offline retry.
 * Submission shape: { id, path, body, enqueuedAt }
 */
export async function enqueue(path, body) {
  const queue = await readQueue();
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    path,
    body: { ...body, wasOfflineSubmission: true },
    enqueuedAt: new Date().toISOString(),
  });
  await writeQueue(queue);
  return queue.length;
}

export async function getPendingCount() {
  const queue = await readQueue();
  return queue.length;
}

export async function getPending() {
  return readQueue();
}

/**
 * Try to flush all pending submissions. Stops on the first network error.
 * Returns { sent, remaining, errors }.
 */
export async function flushQueue() {
  let queue = await readQueue();
  let sent = 0;
  const errors = [];

  while (queue.length > 0) {
    const item = queue[0];
    try {
      await api(item.path, { method: 'POST', body: item.body });
      sent++;
      queue = queue.slice(1);
      await writeQueue(queue);
    } catch (err) {
      // Network error: stop and try again later
      if (!err.status) {
        errors.push({ id: item.id, reason: err.message });
        break;
      }
      // 4xx: drop the bad submission so it doesn't block the queue forever
      if (err.status >= 400 && err.status < 500) {
        errors.push({ id: item.id, reason: err.message, dropped: true });
        queue = queue.slice(1);
        await writeQueue(queue);
        continue;
      }
      // 5xx: bail and retry later
      errors.push({ id: item.id, reason: err.message });
      break;
    }
  }

  return { sent, remaining: queue.length, errors };
}

/**
 * Try the action online. If it fails with a network-level error, queue it.
 * Returns { ok, queued, response, error }.
 */
export async function submitOrQueue(path, body) {
  try {
    const response = await api(path, { method: 'POST', body });
    return { ok: true, queued: false, response };
  } catch (err) {
    // Only queue on transport-level failures (no status). 4xx/5xx surface to UI.
    if (!err.status) {
      await enqueue(path, body);
      return { ok: false, queued: true, error: err };
    }
    return { ok: false, queued: false, error: err };
  }
}
