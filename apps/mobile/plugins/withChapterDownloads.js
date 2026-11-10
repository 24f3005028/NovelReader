const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

module.exports = function withChapterDownloads(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    AndroidConfig.Permissions.addPermission(manifest, 'android.permission.FOREGROUND_SERVICE');
    AndroidConfig.Permissions.addPermission(
      manifest,
      'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
    );
    AndroidConfig.Permissions.addPermission(manifest, 'android.permission.WAKE_LOCK');
    AndroidConfig.Permissions.addPermission(manifest, 'android.permission.POST_NOTIFICATIONS');
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    const name = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
    application.service = (application.service || []).filter(
      (service) => service.$['android:name'] !== name,
    );
    application.service.push({
      $: {
        'android:name': name,
        'android:exported': 'false',
        'android:foregroundServiceType': 'dataSync',
      },
    });
    return config;
  });
};
