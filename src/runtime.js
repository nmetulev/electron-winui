const fs = require('node:fs');
const path = require('node:path');

let runtime;

function resolveBootstrapDllPath({
  architecture = process.arch,
  configuredPath = process.env.WINAPPSDK_BOOTSTRAP_DLL_PATH,
  directory = __dirname,
  existsSync = fs.existsSync,
} = {}) {
  const windowsArchitecture = { arm64: 'arm64', x64: 'x64' }[architecture];
  if (!windowsArchitecture) {
    throw new Error(`Unsupported Electron architecture: ${architecture}`);
  }
  if (configuredPath && existsSync(configuredPath)) {
    return configuredPath;
  }

  const bundled = path.join(
    directory,
    'runtime',
    windowsArchitecture,
    'Microsoft.WindowsAppRuntime.Bootstrap.dll'
  );
  if (existsSync(bundled)) {
    return bundled;
  }

  const configuredDetail = configuredPath
    ? ` Configured path does not exist: ${configuredPath}.`
    : '';
  throw new Error(
    `Windows App SDK bootstrap DLL was not found for ${windowsArchitecture}.` +
      configuredDetail +
      ' Reinstall electron-winui or set WINAPPSDK_BOOTSTRAP_DLL_PATH to a compatible bootstrap DLL.'
  );
}

function initializeWinAppSdk(initWinappsdk, bootstrapPath) {
  process.env.WINAPPSDK_BOOTSTRAP_DLL_PATH = bootstrapPath;
  try {
    initWinappsdk(2, 2);
  } catch (error) {
    throw new Error(
      `Windows App SDK initialization failed using ${bootstrapPath}. ` +
        'Install a compatible Windows App SDK runtime or point WINAPPSDK_BOOTSTRAP_DLL_PATH to its bootstrap DLL.',
      { cause: error }
    );
  }
}

function createRuntime(dependencies = {}) {
  const electron = dependencies.electron ?? require('electron');
  const { app } = electron;
  if (!app.isReady()) {
    throw new Error('WinUIWindow can only be created after app.whenReady().');
  }

  const bootstrapPath =
    dependencies.bootstrapPath ??
    resolveBootstrapDllPath(dependencies.bootstrapOptions);
  const dynwinrt = dependencies.dynwinrt ?? require('@microsoft/dynwinrt');
  initializeWinAppSdk(dynwinrt.initWinappsdk, bootstrapPath);
  dynwinrt.roInitialize(0);

  const bindings = dependencies.bindings ?? require('./bindings');
  const existingDispatcherQueue =
    bindings.DispatcherQueue.getForCurrentThread();
  const dispatcherController = existingDispatcherQueue
    ? null
    : bindings.DispatcherQueueController.createOnCurrentThread();

  let application;
  try {
    application =
      bindings.Application.current ??
      bindings.Application.create();
  } catch (error) {
    throw new Error(
      'WinUI initialization failed. The Electron executable must declare ' +
        'PerMonitorV2 DPI awareness. Run `npx electron-winui prepare` before development ' +
        'and patch packaged executables before signing.',
      { cause: error }
    );
  }

  const existingXamlManager =
    bindings.WindowsXamlManager.getForCurrentThread();
  const xamlManager =
    existingXamlManager ??
    bindings.WindowsXamlManager.initializeForCurrentThread();
  let disposed = false;

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    if (!existingXamlManager) {
      xamlManager.close();
    }
    dispatcherController?.shutdownQueue();
  }

  app.once('will-quit', dispose);

  return {
    application,
    bindings,
    dispatcherController,
    dispose,
    xamlManager,
  };
}

function getRuntime() {
  runtime ??= createRuntime();
  return runtime;
}

module.exports = {
  createRuntime,
  getRuntime,
  initializeWinAppSdk,
  resolveBootstrapDllPath,
};
