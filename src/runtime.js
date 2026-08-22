const {
  bootstrapDllPath,
  initializeWindowsRuntime,
  loadRuntimeContract,
  winUiInitializationError,
} = require('./windows-app-sdk');

let runtime;

function createRuntime(dependencies = {}) {
  const app =
    dependencies.app ??
    dependencies.electron?.app ??
    require('electron').app;
  if (!app.isReady()) {
    throw new Error('WinUIWindow can only be created after app.whenReady().');
  }

  const windowsAppSdk =
    (dependencies.loadRuntimeContract ?? loadRuntimeContract)();
  const {
    hasPackageIdentity,
    initWinappsdk,
    roInitialize,
  } = dependencies.dynwinrt ?? require('@microsoft/dynwinrt');
  const { packaged } = initializeWindowsRuntime({
    contract: windowsAppSdk,
    env: dependencies.env,
    hasPackageIdentity,
    initWinappsdk,
    resolveBootstrapDllPath:
      dependencies.resolveBootstrapDllPath ??
      dependencies.bootstrapDllPath ??
      bootstrapDllPath,
    roInitialize,
  });

  let bindings;
  let dispatcherController;
  let application;
  let existingXamlManager;
  let xamlManager;
  try {
    bindings =
      dependencies.bindings ??
      dependencies.loadBindings?.() ??
      require('./bindings');
    const existingDispatcherQueue =
      bindings.DispatcherQueue.getForCurrentThread();
    dispatcherController = existingDispatcherQueue
      ? null
      : bindings.DispatcherQueueController.createOnCurrentThread();
    application =
      bindings.Application.current ??
      bindings.Application.create();
    existingXamlManager =
      bindings.WindowsXamlManager.getForCurrentThread();
    xamlManager =
      existingXamlManager ??
      bindings.WindowsXamlManager.initializeForCurrentThread();
  } catch (error) {
    dispatcherController?.shutdownQueue();
    throw winUiInitializationError(error, {
      contract: windowsAppSdk,
      packaged,
    });
  }

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
