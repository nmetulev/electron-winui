const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const {
  bootstrapDllPath,
  initializeWindowsAppSdk,
  loadRuntimeContract,
} = require('../src/windows-app-sdk');

const toolsPromise = import('../scripts/windows-app-sdk.mjs');
const temporaryDirectories = [];

function temporaryDirectory() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'electron-winui-version-test-')
  );
  temporaryDirectories.push(directory);
  return directory;
}

function writeWinappYaml(packageRoot, version = '2.2.0') {
  fs.writeFileSync(
    path.join(packageRoot, 'winapp.yaml'),
    `packages:\n  - name: Microsoft.WindowsAppSDK\n    version: ${version}\n`
  );
}

function writeLockfile(packageRoot, version) {
  const winappDirectory = path.join(packageRoot, '.winapp');
  const nugetCacheDir = path.join(packageRoot, 'nuget');
  fs.mkdirSync(winappDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(winappDirectory, 'winmds.lock.json'),
    JSON.stringify({
      schema: 3,
      nuget_cache_dir: nugetCacheDir,
      packages: [
        { name: 'Microsoft.WindowsAppSDK', version, winmds: [] },
        {
          name: 'Microsoft.WindowsAppSDK.Foundation',
          version,
          winmds: [],
        },
      ],
    })
  );
  return nugetCacheDir;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('uses the winapp.yaml package pin as the zero-config default', async () => {
  const { resolveWindowsAppSdkContract } = await toolsPromise;
  const packageRoot = temporaryDirectory();
  writeWinappYaml(packageRoot);

  const contract = resolveWindowsAppSdkContract({ packageRoot, env: {} });

  assert.equal(contract.packageVersion, '2.2.0');
  assert.equal(contract.release, '2.2');
  assert.equal(contract.overridden, false);
});

test('applies an explicit developer override without changing winapp.yaml', async () => {
  const {
    createEffectiveWinappYaml,
    resolveWindowsAppSdkContract,
    VERSION_OVERRIDE_ENV,
  } = await toolsPromise;
  const packageRoot = temporaryDirectory();
  writeWinappYaml(packageRoot);

  const contract = resolveWindowsAppSdkContract({
    packageRoot,
    env: { [VERSION_OVERRIDE_ENV]: '2.1.3-preview.1' },
  });
  const effectiveYaml = createEffectiveWinappYaml(contract);

  assert.match(effectiveYaml, /version: 2\.1\.3-preview\.1/);
  assert.match(
    fs.readFileSync(path.join(packageRoot, 'winapp.yaml'), 'utf8'),
    /version: 2\.2\.0/
  );
});

test('rejects malformed developer overrides with the controlling variable named', async () => {
  const {
    resolveWindowsAppSdkContract,
    VERSION_OVERRIDE_ENV,
  } = await toolsPromise;
  const packageRoot = temporaryDirectory();
  writeWinappYaml(packageRoot);

  assert.throws(
    () =>
      resolveWindowsAppSdkContract({
        packageRoot,
        env: { [VERSION_OVERRIDE_ENV]: '2.2' },
      }),
    new RegExp(`${VERSION_OVERRIDE_ENV}.*major\\.minor\\.patch`)
  );
});

test('fails before build when restore metadata does not match the contract', async () => {
  const { assertRestoredWindowsAppSdk, VERSION_OVERRIDE_ENV } =
    await toolsPromise;
  const packageRoot = temporaryDirectory();
  const nugetRoot = writeLockfile(packageRoot, '2.1.0');

  assert.throws(
    () =>
      assertRestoredWindowsAppSdk(packageRoot, {
        packageVersion: '2.2.0',
        overridden: true,
      }, {
        NUGET_PACKAGES: nugetRoot,
      }),
    new RegExp(
      `build requires 2\\.2\\.0.*contains 2\\.1\\.0.*${VERSION_OVERRIDE_ENV}`
    )
  );
});

test('only locates bootstrap DLLs restored for the effective version', async () => {
  const { assertRestoredWindowsAppSdk, findBootstrapDll } = await toolsPromise;
  const packageRoot = temporaryDirectory();
  const nugetRoot = writeLockfile(packageRoot, '2.2.0');
  const contract = { packageVersion: '2.2.0', overridden: false };
  const restoreMetadata = assertRestoredWindowsAppSdk(
    packageRoot,
    contract,
    { NUGET_PACKAGES: nugetRoot }
  );
  const wrongVersionDll = path.join(
    nugetRoot,
    'microsoft.windowsappsdk.foundation',
    '2.1.0',
    'runtimes',
    'win-x64',
    'native',
    'Microsoft.WindowsAppRuntime.Bootstrap.dll'
  );
  fs.mkdirSync(path.dirname(wrongVersionDll), { recursive: true });
  fs.writeFileSync(wrongVersionDll, 'not a dll');

  assert.throws(
    () =>
      findBootstrapDll('x64', contract, restoreMetadata),
    /Windows App SDK 2\.2\.0 bootstrap DLL was not found/
  );
});

test('rejects a traversal version in restore metadata', async () => {
  const { assertRestoredWindowsAppSdk } = await toolsPromise;
  const packageRoot = temporaryDirectory();
  const nugetRoot = writeLockfile(packageRoot, '..\\..\\Windows\\System32');

  assert.throws(
    () =>
      assertRestoredWindowsAppSdk(
        packageRoot,
        { packageVersion: '..\\..\\Windows\\System32', overridden: false },
        { NUGET_PACKAGES: nugetRoot }
      ),
    /must be a NuGet version/
  );
});

test('rejects restore metadata for a different NuGet cache', async () => {
  const { assertRestoredWindowsAppSdk } = await toolsPromise;
  const packageRoot = temporaryDirectory();
  writeLockfile(packageRoot, '2.2.0');

  assert.throws(
    () =>
      assertRestoredWindowsAppSdk(
        packageRoot,
        { packageVersion: '2.2.0', overridden: false },
        { NUGET_PACKAGES: path.join(packageRoot, 'other-nuget') }
      ),
    /cannot safely locate.*active NuGet cache/
  );
});

test('build tooling forwards supported WinAppCLI arguments and owns config-dir', async () => {
  const { buildWinappArgs } = await import('../scripts/winapp.mjs');
  const restoreArgs = buildWinappArgs(
    'restore',
    'C:\\repo',
    'C:\\config',
    ['--verbose']
  );

  assert.deepEqual(restoreArgs, [
    'restore',
    'C:\\repo',
    '--config-dir',
    'C:\\config',
    '--verbose',
  ]);
  assert.throws(
    () =>
      buildWinappArgs('restore', 'C:\\repo', 'C:\\config', [
        '--config-dir=C:\\other',
      ]),
    /--config-dir is managed by electron-winui/
  );
});

test('runtime always selects its package-owned bootstrap DLL', () => {
  const packageRoot = temporaryDirectory();
  const bundledDll = path.join(
    packageRoot,
    'runtime',
    'x64',
    'Microsoft.WindowsAppRuntime.Bootstrap.dll'
  );
  const arbitraryDll = path.join(packageRoot, 'arbitrary.dll');
  fs.mkdirSync(path.dirname(bundledDll), { recursive: true });
  fs.writeFileSync(bundledDll, 'bundled');
  fs.writeFileSync(arbitraryDll, 'arbitrary');

  const previous = process.env.WINAPPSDK_BOOTSTRAP_DLL_PATH;
  process.env.WINAPPSDK_BOOTSTRAP_DLL_PATH = arbitraryDll;
  try {
    assert.equal(bootstrapDllPath(packageRoot, 'x64'), bundledDll);
  } finally {
    if (previous === undefined) {
      delete process.env.WINAPPSDK_BOOTSTRAP_DLL_PATH;
    } else {
      process.env.WINAPPSDK_BOOTSTRAP_DLL_PATH = previous;
    }
  }
});

test('runtime rejects a contract whose package and bootstrap releases differ', () => {
  const packageRoot = temporaryDirectory();
  fs.writeFileSync(
    path.join(packageRoot, 'windows-app-sdk.runtime.json'),
    JSON.stringify({
      packageVersion: '2.2.0',
      release: { major: 2, minor: 1 },
    })
  );

  assert.throws(
    () => loadRuntimeContract(packageRoot),
    /runtime contract.*is incompatible/
  );
});

test('runtime initialization is idempotent for a compatible process graph', () => {
  let selectedRelease;
  const initialize = (major, minor) => {
    const requested = `${major}.${minor}`;
    if (selectedRelease && selectedRelease !== requested) {
      throw new Error(`already initialized for ${selectedRelease}`);
    }
    selectedRelease = requested;
  };
  const contract = { major: 2, minor: 2, packageVersion: '2.2.0' };

  initializeWindowsAppSdk(initialize, contract);
  initializeWindowsAppSdk(initialize, contract);

  assert.equal(selectedRelease, '2.2');
});

test('runtime reports a deterministic error for an incompatible process graph', () => {
  const initialize = () => {
    throw new Error(
      'Windows App SDK is already initialized for 2.1; cannot reinitialize for 2.2'
    );
  };

  assert.throws(
    () =>
      initializeWindowsAppSdk(initialize, {
        major: 2,
        minor: 2,
        packageVersion: '2.2.0',
      }),
    (error) => {
      assert.match(error.message, /electron-winui requires Windows App SDK 2\.2/);
      assert.match(error.message, /initialize the same Windows App SDK/);
      assert.match(error.cause.message, /already initialized for 2\.1/);
      return true;
    }
  );
});
