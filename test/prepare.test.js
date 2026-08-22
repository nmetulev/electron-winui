const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const {
  hasPerMonitorV2Manifest,
  prepareElectronExecutable,
} = require('../src/prepare');

const temporaryDirectories = [];

function createTemporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-winui-prepare-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('detects a PerMonitorV2 manifest without platform dependencies', () => {
  assert.equal(
    hasPerMonitorV2Manifest('electron.exe', {
      readFileSync: () => Buffer.from('before PerMonitorV2 after'),
    }),
    true
  );
  assert.equal(
    hasPerMonitorV2Manifest('electron.exe', {
      readFileSync: () => Buffer.from('PerMonitor'),
    }),
    false
  );
});

test('preserves non-Windows behavior without touching the executable', async () => {
  assert.equal(
    await prepareElectronExecutable('relative/electron', {
      platform: 'linux',
      existsSync: () => {
        throw new Error('must not inspect the file');
      },
    }),
    'relative/electron'
  );
});

test('reports a resolved missing executable path', async () => {
  await assert.rejects(
    prepareElectronExecutable('missing.exe', {
      existsSync: () => false,
      platform: 'win32',
      resolvePath: (value) => `C:\\resolved\\${value}`,
    }),
    /Electron executable was not found at C:\\resolved\\missing\.exe\./
  );
});

test('patches and verifies an executable through an injected rcedit seam', async () => {
  const directory = createTemporaryDirectory();
  const executable = path.join(directory, 'electron.exe');
  const manifest = path.join(directory, 'electron-pmv2.manifest');
  fs.writeFileSync(executable, 'original executable');
  fs.writeFileSync(manifest, 'PerMonitorV2');

  const patched = await prepareElectronExecutable(executable, {
    directory,
    importRcedit: async () => ({
      rcedit: async (target, options) => {
        assert.equal(target, executable);
        assert.equal(options['application-manifest'], manifest);
        fs.appendFileSync(target, ' PerMonitorV2');
      },
    }),
    platform: 'win32',
  });

  assert.equal(patched, executable);
  assert.equal(hasPerMonitorV2Manifest(executable), true);
});

test('fails when the resource editor does not apply the manifest', async () => {
  const directory = createTemporaryDirectory();
  const executable = path.join(directory, 'electron.exe');
  fs.writeFileSync(executable, 'original executable');

  await assert.rejects(
    prepareElectronExecutable(executable, {
      directory,
      importRcedit: async () => ({ rcedit: async () => {} }),
      platform: 'win32',
    }),
    /Failed to apply the PerMonitorV2 manifest/
  );
});
