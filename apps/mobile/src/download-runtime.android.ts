import { PermissionsAndroid, Platform } from 'react-native';
import BackgroundService from 'react-native-background-actions';

export async function runDownloadTask(task: () => Promise<void>, total: number, pause: () => void) {
  if (Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  BackgroundService.on('expiration', pause);
  try {
    await BackgroundService.start(
      async () => {
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
    );
  } catch (error) {
    BackgroundService.off('expiration', pause);
    throw error;
  }
}

export async function updateDownloadNotification(saved: number, total: number) {
  if (!BackgroundService.isRunning()) return;
  await BackgroundService.updateNotification({
    taskDesc: `${saved} of ${total} chapters saved`,
    progressBar: { max: total, value: saved },
  });
}
