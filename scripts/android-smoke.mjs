import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const serial = process.argv[2];
const packageName = process.argv[3] || 'host.exp.exponent';
if (!serial) throw new Error('Usage: node scripts/android-smoke.mjs DEVICE_SERIAL [PACKAGE_NAME]');
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageName))
  throw new Error('Invalid Android package name');
const adb = process.env.ADB_PATH || path.resolve('.tools/platform-tools/adb.exe');
function run(args, binary = false) {
  const result = spawnSync(adb, ['-s', serial, ...args], {
    encoding: binary ? undefined : 'utf8',
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(String(result.error || result.stderr || `ADB exited ${result.status}`));
  return result.stdout;
}
mkdirSync('tmp', { recursive: true });
const foreground =
  String(run(['shell', 'dumpsys', 'activity', 'activities']))
    .split('\n')
    .find((line) => /topResumedActivity|mResumedActivity/.test(line)) || '';
if (!foreground.includes(`${packageName}/`)) {
  console.log(
    `${packageName} is not in the foreground. Skipping screenshots and leaving the current app alone.`,
  );
  process.exit(0);
}
const screenshot = run(['exec-out', 'screencap', '-p'], true);
writeFileSync('tmp/android-preview.png', screenshot);
const pid = String(run(['shell', 'pidof', packageName]))
  .trim()
  .split(' ')[0];
if (pid) {
  const logs = String(
    run([
      'logcat',
      `--pid=${pid}`,
      '-d',
      '-t',
      '300',
      'ReactNativeJS:E',
      'AndroidRuntime:E',
      'Expo:E',
      '*:S',
    ]),
  );
  writeFileSync('tmp/android-errors.log', logs);
  console.log(
    logs.slice(-5000) || 'No JavaScript or Android runtime errors in the captured app logs.',
  );
}
console.log('Saved device screenshot to tmp/android-preview.png');
