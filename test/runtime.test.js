const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const {
  createRuntime,
  initializeWinAppSdk,
  resolveBootstrapDllPath,
} = require('../src/runtime');

test('prefers an existing configured bootstrap DLL', () => {
  assert.equal(
    resolveBootstrapDllPath({
      architecture: 'x64',
      configuredPath: 'C:\\runtime\\bootstrap.dll',
      existsSync: (candidate) => candidate === 'C:\\runtime\\bootstrap.dll',
    }),
    'C:\\runtime\\bootstrap.dll'
  );
});

test('resolves the bundled bootstrap DLL for the current architecture', () => {
  const expected = path.join(
    'C:\\package\\dist',
    'runtime',
    'arm64',
    'Microsoft.WindowsAppRuntime.Bootstrap.dll'
  );
  assert.equal(
    resolveBootstrapDllPath({
      architecture: 'arm64',
      configuredPath: '',
      directory: 'C:\\package\\dist',
      existsSync: (candidate) => candidate === expected,
    }),
    expected
  );
});

test('reports missing configured and bundled bootstrap DLLs actionably', () => {
  assert.throws(
    () =>
      resolveBootstrapDllPath({
        architecture: 'x64',
        configuredPath: 'C:\\missing\\bootstrap.dll',
        existsSync: () => false,
      }),
    (error) => {
      assert.match(error.message, /Windows App SDK bootstrap DLL was not found for x64/);
      assert.match(error.message, /Configured path does not exist: C:\\missing\\bootstrap\.dll/);
      assert.match(error.message, /Reinstall electron-winui/);
      return true;
    }
  );
});

test('wraps incompatible Windows App SDK initialization failures', () => {
  const original = process.env.WINAPPSDK_BOOTSTRAP_DLL_PATH;
  const cause = new Error('runtime version mismatch');
  try {
    assert.throws(
      () =>
        initializeWinAppSdk(() => {
          throw cause;
        }, 'C:\\runtime\\bootstrap.dll'),
      (error) => {
        assert.equal(error.cause, cause);
        assert.match(error.message, /Windows App SDK initialization failed/);
        assert.match(error.message, /Install a compatible Windows App SDK runtime/);
        return true;
      }
    );
  } finally {
    if (original === undefined) {
      delete process.env.WINAPPSDK_BOOTSTRAP_DLL_PATH;
    } else {
      process.env.WINAPPSDK_BOOTSTRAP_DLL_PATH = original;
    }
  }
});

test('creates and idempotently disposes an injected runtime', () => {
  let willQuit;
  let xamlCloseCount = 0;
  let queueShutdownCount = 0;
  let roInitializeMode;
  let initializedRelease;
  const disposalOrder = [];
  const application = {};
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
    bootstrapPath: 'C:\\runtime\\bootstrap.dll',
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

  assert.deepEqual(initializedRelease, [2, 2]);
  assert.equal(roInitializeMode, 0);
  assert.equal(runtime.application, application);
  willQuit();
  runtime.dispose();
  assert.equal(xamlCloseCount, 1);
  assert.equal(queueShutdownCount, 1);
  assert.deepEqual(disposalOrder, ['xaml', 'queue']);
});
