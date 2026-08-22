import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertRestoredWindowsAppSdk,
  createEffectiveWinappYaml,
  resolveWindowsAppSdkContract,
  VERSION_OVERRIDE_ENV,
} from './windows-app-sdk.mjs';

const defaultPackageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

export function buildWinappArgs(
  command,
  packageRoot,
  configDir,
  passthroughArgs = []
) {
  if (
    passthroughArgs.some(
      (argument) =>
        argument === '--config-dir' || argument.startsWith('--config-dir=')
    )
  ) {
    throw new Error(
      '--config-dir is managed by electron-winui; use ELECTRON_WINUI_WINAPPSDK_VERSION to override the SDK version.'
    );
  }
  if (command === 'restore') {
    return [
      'restore',
      packageRoot,
      '--config-dir',
      configDir,
      ...passthroughArgs,
    ];
  }
  if (command === 'generate') {
    return [
      'node',
      'generate-bindings',
      '--config-dir',
      configDir,
      ...passthroughArgs,
    ];
  }
  throw new Error(`Unsupported winapp command "${command}". Use restore or generate.`);
}

export function runWinapp(
  command,
  {
    cliPath: cliPathOverride,
    env = process.env,
    packageRoot = defaultPackageRoot,
    passthroughArgs = [],
  } = {}
) {
  const contract = resolveWindowsAppSdkContract({ packageRoot, env });
  const cliPath =
    cliPathOverride ??
    path.join(
      packageRoot,
      'node_modules',
      '@microsoft',
      'winappcli',
      'dist',
      'cli.js'
    );
  if (!fs.existsSync(cliPath)) {
    throw new Error(
      `WinAppCLI was not found at ${cliPath}. Run \`npm install\` before \`npm run ${command}\`.`
    );
  }

  let temporaryConfigDir;
  let configDir = packageRoot;
  try {
    if (contract.overridden) {
      temporaryConfigDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'electron-winui-winapp-')
      );
      fs.writeFileSync(
        path.join(temporaryConfigDir, 'winapp.yaml'),
        createEffectiveWinappYaml(contract)
      );
      configDir = temporaryConfigDir;
      console.log(
        `Using ${VERSION_OVERRIDE_ENV}=${contract.packageVersion} for ${command}.`
      );
    }

    if (command === 'generate') {
      assertRestoredWindowsAppSdk(packageRoot, contract);
    }

    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        ...buildWinappArgs(
          command,
          packageRoot,
          configDir,
          passthroughArgs
        ),
      ],
      {
        cwd: packageRoot,
        env,
        stdio: 'inherit',
      }
    );
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }

    assertRestoredWindowsAppSdk(packageRoot, contract);
  } finally {
    if (temporaryConfigDir) {
      fs.rmSync(temporaryConfigDir, { recursive: true, force: true });
    }
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runWinapp(process.argv[2], { passthroughArgs: process.argv.slice(3) });
}
