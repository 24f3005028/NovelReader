import { PermissionsAndroid, Platform } from 'react-native';
import BackgroundService from 'react-native-background-actions';

export async function runDownloadTask(task: () => Promise<void>, total: number, pause: () => void) {
  if (Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  BackgroundService.on('expiration', pause);
  let started: (() => void) | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    started = resolve;
    timer = setTimeout(() => {
      expired = true;
      reject(new Error('Download service did not start'));
    }, 15000);
  });
  try {
    await Promise.all([
      BackgroundService.start(
        async () => {
          if (expired) return;
          started?.();
          try {
            await task();
          } finally {
            BackgroundService.off('expiration', pause);
          }
        },
        {
          taskName: 'NovelReaderDownloads',
          taskTitle: 'Downloading chapters',
          taskDesc: `0 of ${total} chapters saved`,
          taskIcon: { name: 'ic_launcher', type: 'mipmap' },
          color: '#168bff',
          foregroundServiceType: ['dataSync'],
          progressBar: { max: total, value: 0 },
        },
      ),
      ready,
    ]);
  } catch (error) {
    expired = true;
    BackgroundService.off('expiration', pause);
    await BackgroundService.stop().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function updateDownloadNotification(saved: number, total: number) {
  if (!BackgroundService.isRunning()) return;
  await BackgroundService.updateNotification({
    taskDesc: `${saved} of ${total} chapters saved`,
    progressBar: { max: total, value: saved },
  });
}
