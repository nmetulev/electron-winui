const fs = require('node:fs');
const path = require('node:path');

function hasPerMonitorV2Manifest(executablePath) {
  return fs
    .readFileSync(executablePath)
    .includes(Buffer.from('PerMonitorV2', 'utf8'));
}

async function prepareElectronExecutable(executablePath) {
  if (process.platform !== 'win32') {
    return executablePath;
  }

  let resolvedPath = executablePath;
  if (!resolvedPath) {
    const electron = require('electron');
    if (typeof electron !== 'string') {
      throw new Error(
        'Could not infer Electron executable path from a running Electron process. ' +
          'Pass the packaged executable path explicitly.'
      );
    }
    resolvedPath = electron;
  }

  const target = path.resolve(resolvedPath);
  if (!fs.existsSync(target)) {
    throw new Error(`Electron executable was not found at ${target}.`);
  }
  if (hasPerMonitorV2Manifest(target)) {
    return target;
  }

  const manifestPath = path.join(__dirname, 'electron-pmv2.manifest');
  const { rcedit } = await import('rcedit');
  await rcedit(target, {
    'application-manifest': manifestPath,
  });

  if (!hasPerMonitorV2Manifest(target)) {
    throw new Error(`Failed to apply the PerMonitorV2 manifest to ${target}.`);
  }
  return target;
}

module.exports = {
  hasPerMonitorV2Manifest,
  prepareElectronExecutable,
};
