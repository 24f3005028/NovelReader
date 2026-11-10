export async function runDownloadTask(
  task: () => Promise<void>,
  _total: number,
  _pause: () => void,
) {
  void task();
}

export async function updateDownloadNotification(_saved: number, _total: number) {}
