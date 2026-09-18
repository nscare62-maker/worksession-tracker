import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueuedLocationUpdate } from "../types";
import { api } from "./api";

const QUEUE_KEY = "worksession.locationQueue.v1";

async function readQueue(): Promise<QueuedLocationUpdate[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function writeQueue(items: QueuedLocationUpdate[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

/** Called when a live POST fails (offline / network error) — persists the point so it isn't lost. */
export async function enqueue(update: QueuedLocationUpdate) {
  const queue = await readQueue();
  queue.push(update);
  await writeQueue(queue);
}

export async function queueLength(): Promise<number> {
  return (await readQueue()).length;
}

/** Flushes the queue in one batch call; only removes items the server actually accepted. */
export async function flushQueue(): Promise<{ flushed: number; remaining: number }> {
  const queue = await readQueue();
  if (queue.length === 0) return { flushed: 0, remaining: 0 };

  try {
    const { results } = await api.postLocationBatch(queue);
    const stillFailed = queue.filter((_, i) => !results[i]?.ok);
    await writeQueue(stillFailed);
    return { flushed: queue.length - stillFailed.length, remaining: stillFailed.length };
  } catch {
    // Network still down / batch endpoint unreachable — leave the queue intact for next retry.
    return { flushed: 0, remaining: queue.length };
  }
}
