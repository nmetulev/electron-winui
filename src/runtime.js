const {
  bootstrapDllPath,
  initializeWindowsAppSdk,
  loadRuntimeContract,
} = require('./windows-app-sdk');

let runtime;

function createRuntime(dependencies = {}) {
  const electron = dependencies.electron ?? require('electron');
  const { app } = electron;
  if (!app.isReady()) {
    throw new Error('WinUIWindow can only be created after app.whenReady().');
  }

  const windowsAppSdk =
    (dependencies.loadRuntimeContract ?? loadRuntimeContract)();
  process.env.WINAPPSDK_BOOTSTRAP_DLL_PATH =
    (dependencies.bootstrapDllPath ?? bootstrapDllPath)();
  const dynwinrt = dependencies.dynwinrt ?? require('@microsoft/dynwinrt');
  initializeWindowsAppSdk(dynwinrt.initWinappsdk, windowsAppSdk);
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
};
