const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('../src/runtime');

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
