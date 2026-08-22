const fs = require('node:fs');
const path = require('node:path');

function hasPerMonitorV2Manifest(
  executablePath,
  { readFileSync = fs.readFileSync } = {}
) {
  return readFileSync(executablePath).includes(
    Buffer.from('PerMonitorV2', 'utf8')
  );
}

async function prepareElectronExecutable(executablePath, dependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  if (platform !== 'win32') {
    return executablePath;
  }

  let resolvedPath = executablePath;
  if (!resolvedPath) {
    const electron = dependencies.electron ?? require('electron');
    if (typeof electron !== 'string') {
      throw new Error(
        'Could not infer Electron executable path from a running Electron process. ' +
          'Pass the packaged executable path explicitly.'
      );
    }
    resolvedPath = electron;
  }

  const target = (dependencies.resolvePath ?? path.resolve)(resolvedPath);
  const existsSync = dependencies.existsSync ?? fs.existsSync;
  if (!existsSync(target)) {
    throw new Error(`Electron executable was not found at ${target}.`);
  }
  const manifestDependencies = {
    readFileSync: dependencies.readFileSync ?? fs.readFileSync,
  };
  if (hasPerMonitorV2Manifest(target, manifestDependencies)) {
    return target;
  }

  const manifestPath = path.join(
    dependencies.directory ?? __dirname,
    'electron-pmv2.manifest'
  );
  const { rcedit } = await (dependencies.importRcedit ?? (() => import('rcedit')))();
  await rcedit(target, {
    'application-manifest': manifestPath,
  });

  if (!hasPerMonitorV2Manifest(target, manifestDependencies)) {
    throw new Error(`Failed to apply the PerMonitorV2 manifest to ${target}.`);
  }
  return target;
}

module.exports = {
  hasPerMonitorV2Manifest,
  prepareElectronExecutable,
};
