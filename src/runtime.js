const fs = require('node:fs');
const path = require('node:path');

let runtime;

function bootstrapDllPath() {
  const architecture = { arm64: 'arm64', x64: 'x64' }[process.arch];
  if (!architecture) {
    throw new Error(`Unsupported Electron architecture: ${process.arch}`);
  }

  const configured = process.env.WINAPPSDK_BOOTSTRAP_DLL_PATH;
  if (configured && fs.existsSync(configured)) {
    return configured;
  }

  const bundled = path.join(
    __dirname,
    'runtime',
    architecture,
    'Microsoft.WindowsAppRuntime.Bootstrap.dll'
  );
  if (fs.existsSync(bundled)) {
    return bundled;
  }

  throw new Error(
    `Windows App SDK bootstrap DLL was not found for ${architecture}. ` +
      'Reinstall @microsoft/electron-winui or set WINAPPSDK_BOOTSTRAP_DLL_PATH.'
  );
}

function createRuntime() {
  const { app } = require('electron');
  if (!app.isReady()) {
    throw new Error('WinUIWindow can only be created after app.whenReady().');
  }

  process.env.WINAPPSDK_BOOTSTRAP_DLL_PATH = bootstrapDllPath();
  const { initWinappsdk, roInitialize } = require('@microsoft/dynwinrt');
  initWinappsdk(2, 2);
  roInitialize(0);

  const bindings = require('./bindings');
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
  getRuntime,
};
