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
  const env = {};

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
      hasPackageIdentity: () => false,
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
    env,
  });

  assert.equal(env.WINAPPSDK_BOOTSTRAP_DLL_PATH, bootstrapPath);
  assert.deepEqual(initializedRelease, [2, 2]);
  assert.equal(roInitializeMode, 0);
  assert.equal(runtime.application, application);
  willQuit();
  runtime.dispose();
  assert.equal(xamlCloseCount, 1);
  assert.equal(queueShutdownCount, 1);
  assert.deepEqual(disposalOrder, ['xaml', 'queue']);
});

const runtimeContract = {
  major: 2,
  minor: 2,
  packageVersion: '2.2.0',
};

function runtimeDependencies({ packaged, loadBindings } = {}) {
  const calls = {
    bootstrap: 0,
    initWinappsdk: [],
    roInitialize: [],
  };
  const env = {
    WINAPPSDK_BOOTSTRAP_DLL_PATH: 'C:\\untrusted\\bootstrap.dll',
  };
  const bindings = {
    Application: { current: {} },
    DispatcherQueue: { getForCurrentThread: () => ({}) },
    WindowsXamlManager: { getForCurrentThread: () => ({}) },
  };

  return {
    calls,
    dependencies: {
      app: {
        isReady: () => true,
        once: () => {},
      },
      dynwinrt: {
        hasPackageIdentity: () => packaged,
        initWinappsdk: (...args) => calls.initWinappsdk.push(args),
        roInitialize: (...args) => calls.roInitialize.push(args),
      },
      env,
      loadBindings: loadBindings ?? (() => bindings),
      loadRuntimeContract: () => runtimeContract,
      resolveBootstrapDllPath: () => {
        calls.bootstrap += 1;
        return 'C:\\package\\bootstrap.dll';
      },
    },
    env,
  };
}

test('packaged runtime skips bootstrap and initializes the Windows Runtime', () => {
  const { calls, dependencies, env } = runtimeDependencies({
    packaged: true,
  });

  createRuntime(dependencies);

  assert.equal(calls.bootstrap, 0);
  assert.deepEqual(calls.initWinappsdk, []);
  assert.deepEqual(calls.roInitialize, [[0]]);
  assert.equal(
    env.WINAPPSDK_BOOTSTRAP_DLL_PATH,
    'C:\\untrusted\\bootstrap.dll'
  );
});

test('unpackaged runtime bootstraps the package-owned contract', () => {
  const { calls, dependencies, env } = runtimeDependencies({
    packaged: false,
  });

  createRuntime(dependencies);

  assert.equal(calls.bootstrap, 1);
  assert.equal(
    env.WINAPPSDK_BOOTSTRAP_DLL_PATH,
    'C:\\package\\bootstrap.dll'
  );
  assert.deepEqual(calls.initWinappsdk, [[2, 2]]);
  assert.deepEqual(calls.roInitialize, [[0]]);
});

test('packaged initialization error explains supported deployment choices', () => {
  const cause = new Error('class not registered');
  const { dependencies } = runtimeDependencies({
    packaged: true,
    loadBindings: () => {
      throw cause;
    },
  });

  assert.throws(
    () => createRuntime(dependencies),
    (error) => {
      assert.match(error.message, /packaged process/);
      assert.match(error.message, /Microsoft\.WindowsAppRuntime\.2\.2/);
      assert.match(error.message, /MSIX manifest/);
      assert.match(error.message, /self-contained payload/);
      assert.match(error.message, /do not run the Windows App SDK bootstrap/);
      assert.equal(error.cause, cause);
      return true;
    }
  );
});
