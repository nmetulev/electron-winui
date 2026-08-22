import fs from 'node:fs';
import path from 'node:path';

export const WINDOWS_APP_SDK_PACKAGE = 'Microsoft.WindowsAppSDK';
export const VERSION_OVERRIDE_ENV = 'ELECTRON_WINUI_WINAPPSDK_VERSION';

function parseYamlScalar(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function findPackageVersionLine(contents, packageName) {
  const lines = contents.split(/\r?\n/);
  let packageLine = -1;
  let versionLine = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const packageMatch = lines[index].match(/^\s*-\s+name:\s*(.+?)\s*$/);
    if (!packageMatch) {
      continue;
    }

    const currentName = parseYamlScalar(packageMatch[1].split(/\s+#/, 1)[0]);
    if (currentName !== packageName) {
      continue;
    }
    if (packageLine !== -1) {
      throw new Error(
        `winapp.yaml declares ${packageName} more than once; keep exactly one authoritative version pin.`
      );
    }
    packageLine = index;

    for (let candidate = index + 1; candidate < lines.length; candidate += 1) {
      if (/^\s*-\s+name:/.test(lines[candidate])) {
        break;
      }
      if (/^\s*version:/.test(lines[candidate])) {
        versionLine = candidate;
        break;
      }
    }
  }

  if (packageLine === -1) {
    throw new Error(
      `winapp.yaml does not declare ${packageName}; add a package-owned default version before restoring.`
    );
  }
  if (versionLine === -1) {
    throw new Error(
      `winapp.yaml declares ${packageName} without a version; set an explicit package version.`
    );
  }

  const versionMatch = lines[versionLine].match(
    /^(\s*version:\s*)(["']?)([^"'#\s]+)\2(\s*(?:#.*)?)$/
  );
  if (!versionMatch) {
    throw new Error(
      `winapp.yaml has an unsupported ${packageName} version value on line ${versionLine + 1}.`
    );
  }

  return {
    lines,
    version: versionMatch[3],
    versionLine,
    versionMatch,
  };
}

export function parseWindowsAppSdkVersion(version, source = 'Windows App SDK version') {
  const match = version.match(
    /^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?(?:[-+][0-9A-Za-z]+(?:[0-9A-Za-z.-]*[0-9A-Za-z])?)?$/
  );
  if (!match) {
    throw new Error(
      `${source} must be a NuGet version in major.minor.patch[.revision] form, such as 2.2.0; received "${version}".`
    );
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major > 65535 || minor > 65535) {
    throw new Error(
      `${source} major and minor components must be between 0 and 65535; received "${version}".`
    );
  }

  return {
    major,
    minor,
    packageVersion: version,
    release: `${major}.${minor}`,
  };
}

export function resolveWindowsAppSdkContract({
  packageRoot,
  env = process.env,
} = {}) {
  if (!packageRoot) {
    throw new Error('packageRoot is required to resolve the Windows App SDK contract.');
  }

  const yamlPath = path.join(packageRoot, 'winapp.yaml');
  if (!fs.existsSync(yamlPath)) {
    throw new Error(
      `Windows App SDK contract was not found at ${yamlPath}. Restore winapp.yaml from the package source.`
    );
  }

  const contents = fs.readFileSync(yamlPath, 'utf8');
  const defaultVersion = findPackageVersionLine(
    contents,
    WINDOWS_APP_SDK_PACKAGE
  ).version;
  parseWindowsAppSdkVersion(
    defaultVersion,
    `${WINDOWS_APP_SDK_PACKAGE} in winapp.yaml`
  );

  const override = env[VERSION_OVERRIDE_ENV]?.trim();
  const packageVersion = override || defaultVersion;
  const parsed = parseWindowsAppSdkVersion(
    packageVersion,
    override ? VERSION_OVERRIDE_ENV : `${WINDOWS_APP_SDK_PACKAGE} in winapp.yaml`
  );

  return {
    ...parsed,
    defaultVersion,
    overridden: Boolean(override),
    yamlContents: contents,
    yamlPath,
  };
}

export function createEffectiveWinappYaml(contract) {
  if (!contract?.yamlContents || !contract?.packageVersion) {
    throw new Error('A resolved Windows App SDK contract is required.');
  }

  const match = findPackageVersionLine(
    contract.yamlContents,
    WINDOWS_APP_SDK_PACKAGE
  );
  match.lines[match.versionLine] =
    match.versionMatch[1] +
    match.versionMatch[2] +
    contract.packageVersion +
    match.versionMatch[2] +
    match.versionMatch[4];

  const newline = contract.yamlContents.includes('\r\n') ? '\r\n' : '\n';
  return match.lines.join(newline);
}

function restoreInstruction(contract) {
  return contract.overridden
    ? `Set ${VERSION_OVERRIDE_ENV}=${contract.packageVersion} and run \`npm run restore\`.`
    : 'Run `npm run restore`.';
}

export function assertRestoredWindowsAppSdk(
  packageRoot,
  contract
) {
  const { packageVersion } = contract;
  const lockPath = path.join(packageRoot, '.winapp', 'winmds.lock.json');
  if (!fs.existsSync(lockPath)) {
    throw new Error(
      `Windows App SDK ${packageVersion} has not been restored. ${restoreInstruction(contract)}`
    );
  }

  let lockfile;
  try {
    lockfile = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Windows App SDK restore metadata at ${lockPath} is invalid. Delete .winapp and run \`npm run restore\` again.`,
      { cause: error }
    );
  }

  const schema = Number(lockfile.schema ?? lockfile.schemaVersion);
  if (schema !== 3) {
    throw new Error(
      `Windows App SDK restore metadata schema ${Number.isNaN(schema) ? 'is missing' : schema} is unsupported; expected schema 3. ` +
        `Delete .winapp and ${restoreInstruction(contract)}`
    );
  }

  const packages = Array.isArray(lockfile.packages) ? lockfile.packages : [];
  const restored = packages.find(
    (entry) =>
      typeof entry?.name === 'string' &&
      entry.name.toLowerCase() === WINDOWS_APP_SDK_PACKAGE.toLowerCase()
  );
  if (!restored) {
    throw new Error(
      `Restore metadata does not contain ${WINDOWS_APP_SDK_PACKAGE}. Delete .winapp and run \`npm run restore\` again.`
    );
  }
  if (restored.version !== packageVersion) {
    throw new Error(
      `Windows App SDK restore mismatch: build requires ${packageVersion}, but .winapp contains ${restored.version}. ` +
        restoreInstruction(contract)
    );
  }

  const foundation = packages.find(
    (entry) =>
      typeof entry?.name === 'string' &&
      entry.name.toLowerCase() ===
        'Microsoft.WindowsAppSDK.Foundation'.toLowerCase()
  );
  if (foundation?.version) {
    parseWindowsAppSdkVersion(
      foundation.version,
      'Microsoft.WindowsAppSDK.Foundation in restore metadata'
    );
  }
  const nugetCacheDir = lockfile.nuget_cache_dir ?? lockfile.nugetCacheDir;
  if (
    !foundation?.version ||
    typeof nugetCacheDir !== 'string' ||
    !path.isAbsolute(nugetCacheDir) ||
    path.parse(nugetCacheDir).root === path.resolve(nugetCacheDir) ||
    nugetCacheDir.startsWith('\\\\') ||
    nugetCacheDir.startsWith('//')
  ) {
    throw new Error(
      `Restore metadata cannot safely locate the resolved Windows App SDK Foundation package in its recorded NuGet cache. ` +
        `Delete .winapp and ${restoreInstruction(contract)}`
    );
  }

  return {
    foundationVersion: foundation.version,
    nugetCacheDir: path.resolve(nugetCacheDir),
  };
}

export function bootstrapCandidates(
  architecture,
  restoreMetadata
) {
  if (!['arm64', 'x64'].includes(architecture)) {
    throw new Error(`Unsupported Windows App SDK architecture: ${architecture}.`);
  }

  return [
    path.join(
      restoreMetadata.nugetCacheDir,
      'microsoft.windowsappsdk.foundation',
      restoreMetadata.foundationVersion,
      'runtimes',
      `win-${architecture}`,
      'native',
      'Microsoft.WindowsAppRuntime.Bootstrap.dll'
    ),
  ];
}

export function findBootstrapDll(
  architecture,
  contract,
  restoreMetadata
) {
  const candidates = bootstrapCandidates(architecture, restoreMetadata);
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) {
    throw new Error(
      `Windows App SDK ${contract.packageVersion} bootstrap DLL was not found for ${architecture}. ` +
        restoreInstruction(contract) +
        ' ' +
        `Checked: ${candidates.join(', ')}`
    );
  }

  const cacheRoot = fs.realpathSync.native(restoreMetadata.nugetCacheDir);
  const realSource = fs.realpathSync.native(source);
  const relative = path.relative(cacheRoot, realSource);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Windows App SDK bootstrap DLL resolves outside the active NuGet cache: ${source}. ` +
        'Delete .winapp and run `npm run restore` from a trusted workspace.'
    );
  }
  return realSource;
}

export function runtimeContractJson(contract) {
  return `${JSON.stringify(
    {
      packageVersion: contract.packageVersion,
      release: {
        major: contract.major,
        minor: contract.minor,
      },
    },
    null,
    2
  )}\n`;
}
