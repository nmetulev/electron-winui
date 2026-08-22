const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('../src/runtime');

test('creates and idempotently disposes an injected runtime', () => {
  let willQuit;
  let xamlCloseCount = 0;
  let queueShutdownCount = 0;
  let roInitializeMode;
  let initializedRelease;
  const disposalOrder = [];
  const application = {};
  const bootstrapPath = 'C:\\package\\dist\\runtime\\x64\\bootstrap.dll';
  const originalBootstrapPath = process.env.WINAPPSDK_BOOTSTRAP_DLL_PATH;

  try {
    const runtime = createRuntime({
      bindings: {
        Application: {
          current: null,
          create: () => application,
        },
        DispatcherQueue: {
          getForCurrentThread: () => null,
        },
        DispatcherQueueController: {
          createOnCurrentThread: () => ({
            shutdownQueue: () => {
              queueShutdownCount += 1;
              disposalOrder.push('queue');
            },
          }),
        },
        WindowsXamlManager: {
          getForCurrentThread: () => null,
          initializeForCurrentThread: () => ({
            close: () => {
              xamlCloseCount += 1;
              disposalOrder.push('xaml');
            },
          }),
        },
      },
      bootstrapDllPath: () => bootstrapPath,
      loadRuntimeContract: () => ({
        major: 2,
        minor: 2,
        packageVersion: '2.2.0',
      }),
      dynwinrt: {
        initWinappsdk: (major, minor) => {
          initializedRelease = [major, minor];
        },
        roInitialize: (mode) => {
          roInitializeMode = mode;
        },
      },
      electron: {
        app: {
          isReady: () => true,
          once: (event, listener) => {
            assert.equal(event, 'will-quit');
            willQuit = listener;
          },
        },
      },
    });

    assert.equal(process.env.WINAPPSDK_BOOTSTRAP_DLL_PATH, bootstrapPath);
    assert.deepEqual(initializedRelease, [2, 2]);
    assert.equal(roInitializeMode, 0);
    assert.equal(runtime.application, application);
    willQuit();
    runtime.dispose();
    assert.equal(xamlCloseCount, 1);
    assert.equal(queueShutdownCount, 1);
    assert.deepEqual(disposalOrder, ['xaml', 'queue']);
  } finally {
    if (originalBootstrapPath === undefined) {
      delete process.env.WINAPPSDK_BOOTSTRAP_DLL_PATH;
    } else {
      process.env.WINAPPSDK_BOOTSTRAP_DLL_PATH = originalBootstrapPath;
    }
  }
});
