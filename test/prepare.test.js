const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const {
  SIGNATURE_WARNING,
  checkElectronExecutable,
  prepareElectronExecutable,
} = require('../src/prepare');

const originalManifest = `<?xml version="1.0" encoding="UTF-8"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <asmv3:application xmlns:asmv3="urn:schemas-microsoft-com:asm.v3">
    <asmv3:windowsSettings xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">
      <disableWindowFiltering xmlns="http://schemas.microsoft.com/SMI/2011/WindowsSettings">true</disableWindowFiltering>
    </asmv3:windowsSettings>
    <asmv3:windowsSettings xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">
      <dpiAware>true/pm</dpiAware>
    </asmv3:windowsSettings>
  </asmv3:application>
</assembly>`;

const patchedManifest = originalManifest.replace(
  '      <dpiAware>true/pm</dpiAware>',
  `      <dpiAware>true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>`
);

const temporaryDirectories = [];

function createTemporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-winui-prepare-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createFixture(overrides = {}) {
  const directory = createTemporaryDirectory();
  const executable = path.join(directory, 'electron.exe');
  const manifest = path.join(directory, 'electron-pmv2.manifest');
  fs.writeFileSync(executable, 'original executable');
  fs.writeFileSync(manifest, patchedManifest);

  const options = {
    directory,
    extractManifest: async (target) =>
      fs.readFileSync(target, 'utf8').includes('patched executable')
        ? patchedManifest
        : originalManifest,
    getSignatureStatus: async () => 'unsigned',
    embedManifest: async (target, manifestPath) => {
      assert.notEqual(target, executable);
      assert.equal(manifestPath, manifest);
      fs.writeFileSync(target, 'patched executable');
    },
    platform: 'win32',
    ...overrides,
  };
  return {
    backup: `${executable}.electron-winui.backup`,
    directory,
    executable,
    options,
  };
}

afterEach(() => {
  process.exitCode = undefined;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('preserves non-Windows behavior without touching the executable', async () => {
  assert.equal(
    await prepareElectronExecutable('relative/electron', {
      platform: 'linux',
      existsSync: () => {
        throw new Error('must not inspect the file');
      },
      resolvePath: (value) => value,
    }),
    'relative/electron'
  );
});

test('reports a resolved missing executable path', async () => {
  await assert.rejects(
    checkElectronExecutable('missing.exe', {
      existsSync: () => false,
      platform: 'win32',
      resolvePath: (value) => `C:\\resolved\\${value}`,
    }),
    /Electron executable was not found at C:\\resolved\\missing\.exe\./
  );
});

test('checks and dry-runs without modifying the executable', async () => {
  const fixture = createFixture({
    embedManifest: async () => {
      throw new Error('editor must not run');
    },
  });

  const check = await checkElectronExecutable(
    fixture.executable,
    fixture.options
  );
  const dryRun = await prepareElectronExecutable(fixture.executable, {
    ...fixture.options,
    dryRun: true,
  });

  assert.equal(check.compliant, false);
  assert.equal(check.wouldModify, true);
  assert.equal(check.backupPath, fixture.backup);
  assert.deepEqual(dryRun, check);
  assert.equal(fs.readFileSync(fixture.executable, 'utf8'), 'original executable');
  assert.equal(fs.existsSync(fixture.backup), false);
});

test('restores access and modified times after inspection', async () => {
  const restored = [];
  const atime = new Date('2024-01-02T03:04:05Z');
  const mtime = new Date('2024-02-03T04:05:06Z');
  const fixture = createFixture({
    stat: async () => ({ atime, mode: 0o644, mtime }),
    utimes: async (target, restoredAtime, restoredMtime) => {
      restored.push([target, restoredAtime, restoredMtime]);
    },
  });

  await checkElectronExecutable(fixture.executable, fixture.options);

  assert.deepEqual(restored, [[fixture.executable, atime, mtime]]);
});

test('does not accept a same-named DPI element in the wrong namespace or location', async () => {
  const wrongNamespace = originalManifest.replace(
    '<dpiAware>true/pm</dpiAware>',
    `<dpiAware>true/pm</dpiAware>
      <vendor:dpiAwareness xmlns:vendor="urn:vendor">PerMonitorV2</vendor:dpiAwareness>`
  );
  const wrongLocation = originalManifest.replace(
    '</assembly>',
    `<dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
</assembly>`
  );
  const fixture = createFixture();

  for (const manifest of [wrongNamespace, wrongLocation]) {
    const check = await checkElectronExecutable(fixture.executable, {
      ...fixture.options,
      extractManifest: async () => manifest,
    });
    assert.equal(check.compliant, false);
  }
});

test('patches a temporary copy, validates it, and retains an original backup', async () => {
  const fixture = createFixture();
  const originalStat = fs.statSync(fixture.executable);

  const patched = await prepareElectronExecutable(
    fixture.executable,
    fixture.options
  );

  assert.equal(patched, fixture.executable);
  assert.equal(fs.readFileSync(fixture.executable, 'utf8'), 'patched executable');
  assert.equal(fs.readFileSync(fixture.backup, 'utf8'), 'original executable');
  assert.ok(
    Math.abs(fs.statSync(fixture.executable).mtimeMs - originalStat.mtimeMs) < 2
  );
});

test('leaves the original untouched when the resource editor fails', async () => {
  const fixture = createFixture({
    embedManifest: async () => {
      throw new Error('injected editor failure');
    },
  });

  await assert.rejects(
    prepareElectronExecutable(fixture.executable, fixture.options),
    /original remains/
  );
  assert.equal(fs.readFileSync(fixture.executable, 'utf8'), 'original executable');
  assert.equal(fs.existsSync(fixture.backup), false);
});

test('leaves the original untouched when candidate validation fails', async () => {
  const fixture = createFixture({
    extractManifest: async () => originalManifest,
  });

  await assert.rejects(
    prepareElectronExecutable(fixture.executable, fixture.options),
    /original remains/
  );
  assert.equal(fs.readFileSync(fixture.executable, 'utf8'), 'original executable');
  assert.equal(fs.existsSync(fixture.backup), false);
});

test('rejects a candidate that drops existing manifest content', async () => {
  const fixture = createFixture({
    extractManifest: async (target) =>
      fs.readFileSync(target, 'utf8').includes('patched executable')
        ? patchedManifest.replace(/<disableWindowFiltering.*?disableWindowFiltering>\s*/s, '')
        : originalManifest,
  });

  await assert.rejects(
    prepareElectronExecutable(fixture.executable, fixture.options),
    /original remains/
  );
  assert.equal(fs.readFileSync(fixture.executable, 'utf8'), 'original executable');
});

test('rolls back from the backup when replacement is interrupted', async () => {
  const fixture = createFixture({
    replaceFile: async (_temporaryPath, target) => {
      await fs.promises.rm(target);
      throw new Error('injected interrupted replacement');
    },
  });

  await assert.rejects(
    prepareElectronExecutable(fixture.executable, fixture.options),
    /backup remains/
  );
  assert.equal(fs.readFileSync(fixture.executable, 'utf8'), 'original executable');
  assert.equal(fs.readFileSync(fixture.backup, 'utf8'), 'original executable');
});

test('rolls back when validation fails after replacement', async () => {
  let extraction = 0;
  const fixture = createFixture({
    extractManifest: async () => {
      extraction += 1;
      return extraction === 2 ? patchedManifest : originalManifest;
    },
  });

  await assert.rejects(
    prepareElectronExecutable(fixture.executable, fixture.options),
    /backup remains/
  );
  assert.equal(fs.readFileSync(fixture.executable, 'utf8'), 'original executable');
  assert.equal(fs.readFileSync(fixture.backup, 'utf8'), 'original executable');
});

test('does not overwrite an existing backup', async () => {
  const fixture = createFixture();
  fs.writeFileSync(fixture.backup, 'existing backup');

  await assert.rejects(
    prepareElectronExecutable(fixture.executable, fixture.options),
    /original remains/
  );
  assert.equal(fs.readFileSync(fixture.executable, 'utf8'), 'original executable');
  assert.equal(fs.readFileSync(fixture.backup, 'utf8'), 'existing backup');
});

test('does not edit or create a backup for already-compliant input', async () => {
  const fixture = createFixture({
    extractManifest: async () => patchedManifest,
    embedManifest: async () => {
      throw new Error('editor must not run');
    },
  });

  const check = await checkElectronExecutable(
    fixture.executable,
    fixture.options
  );
  const result = await prepareElectronExecutable(
    fixture.executable,
    fixture.options
  );

  assert.equal(check.compliant, true);
  assert.equal(check.wouldModify, false);
  assert.equal(check.backupPath, null);
  assert.equal(result, fixture.executable);
  assert.equal(fs.existsSync(fixture.backup), false);
});

test('warns about signed binaries and requires explicit invalidation consent', async () => {
  const warnings = [];
  const fixture = createFixture({
    allowSigned: true,
    getSignatureStatus: async () => 'valid',
    warn: (warning) => warnings.push(warning),
  });
  const check = await checkElectronExecutable(
    fixture.executable,
    fixture.options
  );

  assert.equal(check.signatureStatus, 'valid');
  assert.deepEqual(check.warnings, [SIGNATURE_WARNING]);
  await assert.rejects(
    prepareElectronExecutable(fixture.executable, {
      ...fixture.options,
      allowSigned: false,
    }),
    /Refusing to patch signed executable/
  );
  assert.equal(fs.readFileSync(fixture.executable, 'utf8'), 'original executable');

  await prepareElectronExecutable(fixture.executable, fixture.options);
  assert.deepEqual(warnings, [SIGNATURE_WARNING]);
  assert.equal(fs.readFileSync(fixture.backup, 'utf8'), 'original executable');
});
