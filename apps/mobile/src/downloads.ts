import { useSyncExternalStore } from 'react';
import { readerMessage } from './api';
import { fetchChapterOnDemand } from './chapter-service';
import { removeChapters } from './chapter-cache';
import { runDownloadTask, updateDownloadNotification } from './download-runtime';
import { localChapter, read, saveChapter, write } from './storage';

type Queue = { novelId: string; title: string; ids: string[] };
type DownloadState = {
  saved: Record<string, string[]>;
  queue: Queue | null;
  active: boolean;
  progress: string;
  message: string;
  messageNovelId?: string;
  removingNovelId?: string;
};

let state: DownloadState = { saved: {}, queue: null, active: false, progress: '', message: '' };
const listeners = new Set<() => void>();
let loading: Promise<DownloadState> | undefined;
let paused = false;
let queueChanging = false;
let runDone = Promise.resolve();
let finishRun: (() => void) | undefined;
let savedMutation = Promise.resolve();

function updateSaved(work: () => Promise<void>) {
  const result = savedMutation.then(work);
  savedMutation = result.catch(() => {});
  return result;
}

function publish(patch: Partial<DownloadState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => state;
export const useDownloads = () => useSyncExternalStore(subscribe, snapshot, snapshot);

export function loadDownloads() {
  loading ??= Promise.all([
    read<DownloadState['saved']>('downloads', {}),
    read<Queue | null>('downloadQueue', null),
  ])
    .then(([saved, queue]) => {
      publish({ saved, queue });
      return state;
    })
    .catch((error) => {
      loading = undefined;
      throw error;
    });
  return loading.then(() => state);
}

export function pauseDownloads() {
  paused = true;
}

export async function startDownloads(request: Queue) {
  await loadDownloads();
  if (state.active || state.removingNovelId || queueChanging) return;
  if (state.queue && state.queue.novelId !== request.novelId) {
    publish({
      message: 'Resume or clear the paused download from Downloads before starting another book.',
      messageNovelId: request.novelId,
    });
    return;
  }
  const alreadySaved = new Set(state.saved[request.novelId] || []);
  const ids = [...new Set([...(state.queue?.ids || []), ...request.ids])].filter(
    (id) => !alreadySaved.has(id),
  );
  if (!ids.length) {
    await clearDownloadQueue();
    publish({
      message: 'These chapters are already saved offline.',
      messageNovelId: request.novelId,
    });
    return;
  }
  const queue = { ...request, ids };
  paused = false;
  runDone = new Promise((resolve) => {
    finishRun = resolve;
  });
  publish({
    active: true,
    queue,
    progress: `Preparing ${ids.length} chapters…`,
    message: '',
    messageNovelId: queue.novelId,
  });
  try {
    await write('downloadQueue', queue);
    await runDownloadTask(() => processQueue(queue), ids.length, pauseDownloads);
  } catch (error) {
    publish({
      active: false,
      progress: '',
      message: readerMessage(error, 'Couldn’t start the download. Tap Resume to try again.'),
    });
    finishRun?.();
  }
}

async function processQueue(queue: Queue) {
  const deadline = Date.now() + 4 * 60 * 60 * 1000;
  const failed: string[] = [];
  let cursor = 0;
  let savedCount = 0;
  let consecutiveFailures = 0;
  let failureMessage = '';
  try {
    for (; cursor < queue.ids.length && !paused && consecutiveFailures < 3; cursor++) {
      if (Date.now() >= deadline) {
        paused = true;
        break;
      }
      const id = queue.ids[cursor];
      publish({ progress: `${savedCount} of ${queue.ids.length} chapters saved` });
      try {
        const content = (await localChapter(id)) || (await fetchChapterOnDemand(id, () => paused));
        if (paused) break;
        await updateSaved(async () => {
          await saveChapter(content);
          const saved = {
            ...state.saved,
            [queue.novelId]: [...new Set([...(state.saved[queue.novelId] || []), id])],
          };
          await write('downloads', saved);
          publish({ saved });
        });
        savedCount++;
        consecutiveFailures = 0;
        await updateDownloadNotification(savedCount, queue.ids.length).catch(() => {});
      } catch (error) {
        failed.push(id);
        consecutiveFailures++;
        if (!paused) failureMessage = readerMessage(error, 'Some chapters couldn’t be saved.');
      }
    }
    const remaining = [...failed, ...queue.ids.slice(cursor)];
    const next = remaining.length ? { ...queue, ids: remaining } : null;
    await write('downloadQueue', next);
    publish({
      queue: next,
      message: remaining.length
        ? `${paused ? 'Download paused.' : failureMessage} ${remaining.length} chapters left.`
        : `${savedCount} ${savedCount === 1 ? 'chapter' : 'chapters'} saved offline.`,
    });
  } catch (error) {
    publish({
      message: readerMessage(error, 'Couldn’t finish the download. You can resume from Downloads.'),
    });
  } finally {
    publish({ active: false, progress: '' });
    finishRun?.();
  }
}

export async function clearDownloadQueue() {
  if (state.active || state.removingNovelId || queueChanging) return;
  queueChanging = true;
  try {
    await write('downloadQueue', null);
    publish({ queue: null, message: '' });
  } finally {
    queueChanging = false;
  }
}

export async function deleteSavedChapters(novelId: string) {
  await loadDownloads();
  if (state.removingNovelId || queueChanging) return;
  publish({ removingNovelId: novelId });
  try {
    if (state.queue?.novelId === novelId) {
      if (state.active) {
        pauseDownloads();
        await runDone;
      }
      await write('downloadQueue', null);
      publish({ queue: null, message: '', messageNovelId: undefined });
    }
    await updateSaved(async () => {
      await removeChapters(state.saved[novelId] || []);
      const saved = { ...state.saved };
      delete saved[novelId];
      await write('downloads', saved);
      publish({ saved });
    });
  } finally {
    publish({ removingNovelId: undefined });
  }
}
