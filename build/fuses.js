// Paketlenmiş uygulamada Electron'un saldırıya açık özelliklerini kalıcı olarak kapatır.
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async (context) => {
  const uzanti = { darwin: '.app', win32: '.exe', linux: '' }[context.electronPlatformName];
  const exe = path.join(context.appOutDir, context.packager.appInfo.productFilename + uzanti);
  await flipFuses(exe, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: context.electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
};
