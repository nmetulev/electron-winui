const fs = require('node:fs');
const path = require('node:path');

const RUNTIME_CONTRACT_FILE = 'windows-app-sdk.runtime.json';

function loadRuntimeContract(packageDir = __dirname) {
  const contractPath = path.join(packageDir, RUNTIME_CONTRACT_FILE);
  if (!fs.existsSync(contractPath)) {
    throw new Error(
      `Windows App SDK runtime contract was not found at ${contractPath}. Reinstall electron-winui.`
    );
  }

  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Windows App SDK runtime contract at ${contractPath} is invalid. Reinstall electron-winui.`,
      { cause: error }
    );
  }

  const major = contract?.release?.major;
  const minor = contract?.release?.minor;
  const packageVersion = contract?.packageVersion;
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    major < 0 ||
    minor < 0 ||
    major > 65535 ||
    minor > 65535 ||
    typeof packageVersion !== 'string' ||
    !packageVersion.startsWith(`${major}.${minor}.`)
  ) {
    throw new Error(
      `Windows App SDK runtime contract at ${contractPath} is incompatible. Reinstall electron-winui.`
    );
  }

  return { major, minor, packageVersion };
}

function bootstrapDllPath(
  packageDir = __dirname,
  architecture = process.arch
) {
  const runtimeArchitecture = { arm64: 'arm64', x64: 'x64' }[architecture];
  if (!runtimeArchitecture) {
    throw new Error(`Unsupported Electron architecture: ${architecture}`);
  }

  const bundled = path.resolve(
    packageDir,
    'runtime',
    runtimeArchitecture,
    'Microsoft.WindowsAppRuntime.Bootstrap.dll'
  );
  if (!fs.existsSync(bundled)) {
    throw new Error(
      `Package-owned Windows App SDK bootstrap DLL was not found for ${runtimeArchitecture}. ` +
        'Reinstall electron-winui.'
    );
  }
  return bundled;
}

function initializeWindowsAppSdk(initWinappsdk, contract) {
  try {
    initWinappsdk(contract.major, contract.minor);
  } catch (error) {
    throw new Error(
      `electron-winui requires Windows App SDK ${contract.major}.${contract.minor}, but the process package graph could not select that release. ` +
        'Ensure the Electron host and native dependencies initialize the same Windows App SDK major/minor release.',
      { cause: error }
    );
  }
}

module.exports = {
  bootstrapDllPath,
  initializeWindowsAppSdk,
  loadRuntimeContract,
};
