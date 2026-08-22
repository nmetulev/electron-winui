// One-off helper used by test/uia/run-uia-tests.ps1. Resolves the local
// dev Electron executable and (on Windows) applies the same PerMonitorV2
// manifest patch that every other fixture in this repo relies on for a
// native XAML island to initialize correctly - see src/prepare.js and
// test/window.test.js's runElectronFixture() for the exact pattern this
// mirrors. Prints `ELECTRON_EXE=<path>` on success so the calling
// PowerShell script can capture it without needing to duplicate any of the
// resolution/patching logic itself.
const { prepareElectronExecutable } = require('../../dist/prepare');

(async () => {
  const electronExecutable = require('electron');
  if (typeof electronExecutable !== 'string') {
    throw new Error('Could not resolve the Electron executable path.');
  }
  const resolved = await prepareElectronExecutable();
  if (resolved !== electronExecutable) {
    throw new Error(
      `prepareElectronExecutable() returned "${resolved}", expected "${electronExecutable}".`
    );
  }
  process.stdout.write(`ELECTRON_EXE=${resolved}\n`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});