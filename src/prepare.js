const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const { isDeepStrictEqual } = require('node:util');
const { XMLParser } = require('fast-xml-parser');

const execFileAsync = promisify(execFile);
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  preserveOrder: true,
  processEntities: false,
  trimValues: true,
});

const SIGNATURE_WARNING =
  'The executable has an Authenticode signature. Editing resources invalidates it; ' +
  'prepare the executable before signing, or explicitly allow the change and re-sign immediately.';
const ASSEMBLY_NAMESPACE = 'urn:schemas-microsoft-com:asm.v1';
const ASSEMBLY_V3_NAMESPACE = 'urn:schemas-microsoft-com:asm.v3';
const DPI_AWARENESS_NAMESPACE =
  'http://schemas.microsoft.com/SMI/2016/WindowsSettings';

function localName(name) {
  return name.split(':').at(-1);
}

function parseManifest(manifest, executablePath) {
  try {
    return xmlParser.parse(manifest);
  } catch (error) {
    throw new Error(
      `Could not parse the application manifest extracted from ${executablePath}: ${error.message}`,
      { cause: error }
    );
  }
}

function elementText(value) {
  if (Array.isArray(value)) {
    return value.map(elementText).join('');
  }
  if (!value || typeof value !== 'object') {
    return '';
  }
  return Object.entries(value)
    .filter(([name]) => name === '#text' || name !== ':@')
    .map(([, child]) => (typeof child === 'string' ? child : elementText(child)))
    .join('');
}

function elementEntry(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return null;
  }
  const names = Object.keys(value).filter(
    (name) => name !== ':@' && name !== '#text'
  );
  if (names.length !== 1) {
    return null;
  }
  const name = names[0];
  return { name, value: value[name] };
}

function extendNamespaces(parentNamespaces, attributes = {}) {
  const namespaces = { ...parentNamespaces };
  for (const [name, value] of Object.entries(attributes)) {
    if (name === '@_xmlns') {
      namespaces[''] = value;
    } else if (name.startsWith('@_xmlns:')) {
      namespaces[name.slice('@_xmlns:'.length)] = value;
    }
  }
  return namespaces;
}

function namespaceFor(name, namespaces) {
  const separator = name.indexOf(':');
  const prefix = separator === -1 ? '' : name.slice(0, separator);
  return namespaces[prefix] ?? '';
}

function isDpiAwarenessPath(path_) {
  const expected = [
    ['assembly', ASSEMBLY_NAMESPACE],
    ['application', ASSEMBLY_V3_NAMESPACE],
    ['windowsSettings', ASSEMBLY_V3_NAMESPACE],
    ['dpiAwareness', DPI_AWARENESS_NAMESPACE],
  ];
  return (
    path_.length === expected.length &&
    path_.every(
      (entry, index) =>
        entry.name === expected[index][0] &&
        entry.namespace === expected[index][1]
    )
  );
}

function findDpiAwarenessNodes(
  value,
  namespaces = {},
  path_ = [],
  matches = []
) {
  if (Array.isArray(value)) {
    for (const child of value) {
      findDpiAwarenessNodes(child, namespaces, path_, matches);
    }
    return matches;
  }

  const entry = elementEntry(value);
  if (!entry) {
    return matches;
  }
  const elementNamespaces = extendNamespaces(namespaces, value[':@']);
  const elementPath = [
    ...path_,
    {
      name: localName(entry.name),
      namespace: namespaceFor(entry.name, elementNamespaces),
    },
  ];
  if (isDpiAwarenessPath(elementPath)) {
    matches.push({ node: value, value: entry.value });
  }
  findDpiAwarenessNodes(
    entry.value,
    elementNamespaces,
    elementPath,
    matches
  );
  return matches;
}

function manifestHasPerMonitorV2(manifestModel) {
  return findDpiAwarenessNodes(manifestModel).some(
    (match) =>
      elementText(match.value)
        .split(',')
        .some((entry) => entry.trim().toLowerCase() === 'permonitorv2')
  );
}

function withoutNodes(value, excludedNodes) {
  if (Array.isArray(value)) {
    return value
      .filter((child) => !excludedNodes.has(child))
      .map((child) => withoutNodes(child, excludedNodes));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, child]) => [
      name,
      withoutNodes(child, excludedNodes),
    ])
  );
}

function validateCandidateManifest(originalModel, candidateManifest, target) {
  const candidateModel = parseManifest(candidateManifest, target);
  const originalDpiAwareness = findDpiAwarenessNodes(originalModel);
  const candidateDpiAwareness = findDpiAwarenessNodes(candidateModel);
  if (
    candidateDpiAwareness.length !== 1 ||
    elementText(candidateDpiAwareness[0].value).trim().toLowerCase() !==
      'permonitorv2'
  ) {
    throw new Error(
      `Failed to apply a semantic PerMonitorV2 application manifest to ${target}.`
    );
  }
  if (
    !isDeepStrictEqual(
      withoutNodes(
        originalModel,
        new Set(originalDpiAwareness.map((entry) => entry.node))
      ),
      withoutNodes(
        candidateModel,
        new Set(candidateDpiAwareness.map((entry) => entry.node))
      )
    )
  ) {
    throw new Error(
      `Refusing to replace ${target} because the candidate did not preserve the existing ` +
        'Electron application manifest. WinAppCLI can extract manifests but does not yet expose ' +
        'a semantic merge primitive for unknown manifest revisions.'
    );
  }
  return candidateModel;
}

function resolveWinAppCli(dependencies) {
  if (dependencies.winAppCliPath) {
    return dependencies.winAppCliPath;
  }
  try {
    return require.resolve('@microsoft/winappcli/dist/cli.js');
  } catch (error) {
    throw new Error(
      'Safe executable preparation requires @microsoft/winappcli on Windows so mt.exe and ' +
        'signtool.exe can inspect the binary. Reinstall optional dependencies before preparing.',
      { cause: error }
    );
  }
}

async function runWinAppTool(arguments_, dependencies) {
  const execute = dependencies.execFile ?? execFileAsync;
  const cliPath = resolveWinAppCli(dependencies);
  try {
    return await execute(
      process.execPath,
      [cliPath, 'tool', '--quiet', ...arguments_],
      {
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      }
    );
  } catch (error) {
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim();
    error.winAppToolOutput = output;
    throw error;
  }
}

async function extractApplicationManifest(executablePath, dependencies) {
  if (dependencies.extractManifest) {
    return dependencies.extractManifest(executablePath);
  }

  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'electron-winui-manifest-')
  );
  const outputPath = path.join(temporaryDirectory, 'application.manifest');
  try {
    await runWinAppTool(
      [
        'mt.exe',
        '-nologo',
        `-inputresource:${executablePath};#1`,
        `-out:${outputPath}`,
      ],
      dependencies
    );
    return await fs.promises.readFile(outputPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Could not extract the application manifest from ${executablePath} with WinAppCLI mt.exe.` +
        (error.winAppToolOutput ? ` ${error.winAppToolOutput}` : ''),
      { cause: error }
    );
  } finally {
    await fs.promises.rm(temporaryDirectory, { force: true, recursive: true });
  }
}

async function embedApplicationManifest(
  executablePath,
  manifestPath,
  dependencies
) {
  if (dependencies.embedManifest) {
    return dependencies.embedManifest(executablePath, manifestPath);
  }
  try {
    await runWinAppTool(
      [
        'mt.exe',
        '-nologo',
        '-manifest',
        manifestPath,
        `-outputresource:${executablePath};#1`,
      ],
      dependencies
    );
  } catch (error) {
    throw new Error(
      `Could not embed the application manifest into ${executablePath} with WinAppCLI mt.exe.` +
        (error.winAppToolOutput ? ` ${error.winAppToolOutput}` : ''),
      { cause: error }
    );
  }
}

async function getSignatureStatus(executablePath, dependencies) {
  if (dependencies.getSignatureStatus) {
    return dependencies.getSignatureStatus(executablePath);
  }

  try {
    await runWinAppTool(
      ['signtool.exe', 'verify', '/pa', '/v', executablePath],
      dependencies
    );
    return 'valid';
  } catch (error) {
    if (/no signature found/i.test(error.winAppToolOutput ?? '')) {
      return 'unsigned';
    }
    return 'invalid';
  }
}

function resolveExecutablePath(
  executablePath,
  dependencies,
  shouldResolve = true
) {
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
  return shouldResolve
    ? (dependencies.resolvePath ?? path.resolve)(resolvedPath)
    : resolvedPath;
}

function backupPathFor(target, options) {
  return options.backupPath
    ? path.resolve(options.backupPath)
    : `${target}.electron-winui.backup`;
}

function resolveManifestPath(options) {
  if (options.directory) {
    return path.join(options.directory, 'electron-pmv2.manifest');
  }
  const packagedPath = path.join(__dirname, 'electron-pmv2.manifest');
  return fs.existsSync(packagedPath)
    ? packagedPath
    : path.join(__dirname, '..', 'electron-pmv2.manifest');
}

async function inspectElectronExecutable(executablePath, options) {
  const platform = options.platform ?? process.platform;
  const target = resolveExecutablePath(
    executablePath,
    options,
    platform === 'win32'
  );
  if (platform !== 'win32') {
    return {
      manifestModel: null,
      report: {
        backupPath: null,
        compliant: true,
        executablePath: target,
        signatureStatus: 'not-checked',
        supported: false,
        warnings: [
          `Executable manifest preparation is not performed on ${platform}.`,
        ],
        wouldModify: false,
      },
    };
  }

  const existsSync = options.existsSync ?? fs.existsSync;
  if (!existsSync(target)) {
    throw new Error(`Electron executable was not found at ${target}.`);
  }

  const stat = options.stat ?? fs.promises.stat;
  const metadata = await stat(target);
  let manifest;
  let signatureStatus;
  try {
    [manifest, signatureStatus] = await Promise.all([
      extractApplicationManifest(target, options),
      getSignatureStatus(target, options),
    ]);
  } finally {
    const utimes = options.utimes ?? fs.promises.utimes;
    await utimes(target, metadata.atime, metadata.mtime);
  }
  const manifestModel = parseManifest(manifest, target);
  const compliant = manifestHasPerMonitorV2(manifestModel);
  const warnings = [];
  if (signatureStatus !== 'unsigned') {
    warnings.push(SIGNATURE_WARNING);
  }

  return {
    manifestModel,
    metadata,
    report: {
      backupPath: compliant ? null : backupPathFor(target, options),
      compliant,
      executablePath: target,
      signatureStatus,
      supported: true,
      warnings,
      wouldModify: !compliant,
    },
  };
}

async function checkElectronExecutable(executablePath, options = {}) {
  const { report } = await inspectElectronExecutable(executablePath, options);
  return report;
}

async function applyMetadata(filePath, metadata, dependencies) {
  const chmod = dependencies.chmod ?? fs.promises.chmod;
  const utimes = dependencies.utimes ?? fs.promises.utimes;
  await chmod(filePath, metadata.mode);
  await utimes(filePath, metadata.atime, metadata.mtime);
}

async function copyWithMetadata(
  source,
  destination,
  metadata,
  dependencies,
  flags = 0
) {
  const copyFile = dependencies.copyFile ?? fs.promises.copyFile;
  let copied = false;
  try {
    await copyFile(source, destination, flags);
    copied = true;
    await applyMetadata(destination, metadata, dependencies);
  } catch (error) {
    if (copied) {
      await fs.promises.rm(destination, { force: true });
    }
    throw error;
  }
}

async function pathExists(filePath, dependencies) {
  const access = dependencies.access ?? fs.promises.access;
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function restoreBackup(target, backupPath, metadata, dependencies) {
  const rollbackPath = `${target}.${randomUUID()}.rollback`;
  const replaceFile = dependencies.restoreFile ?? fs.promises.rename;
  try {
    await copyWithMetadata(
      backupPath,
      rollbackPath,
      metadata,
      dependencies,
      fs.constants.COPYFILE_EXCL
    );
    await replaceFile(rollbackPath, target);
  } finally {
    await fs.promises.rm(rollbackPath, { force: true });
  }
}

async function prepareElectronExecutable(executablePath, options = {}) {
  const inspection = await inspectElectronExecutable(executablePath, options);
  const { manifestModel, metadata, report } = inspection;
  if (options.dryRun) {
    return report;
  }
  if (!report.supported || report.compliant) {
    return report.executablePath;
  }
  if (report.signatureStatus !== 'unsigned' && !options.allowSigned) {
    throw new Error(
      `Refusing to patch signed executable ${report.executablePath}. ${SIGNATURE_WARNING} ` +
        'Pass { allowSigned: true } only when the next build step re-signs the executable.'
    );
  }
  if (report.signatureStatus !== 'unsigned') {
    const warn =
      options.warn ??
      ((message) =>
        process.emitWarning(message, {
          code: 'ELECTRON_WINUI_SIGNATURE_INVALIDATED',
        }));
    warn(SIGNATURE_WARNING);
  }

  const target = report.executablePath;
  const backupPath = report.backupPath;
  const directory = path.dirname(target);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(target)}.${randomUUID()}.electron-winui.tmp.exe`
  );
  const manifestPath = resolveManifestPath(options);
  let backupCreated = false;
  let replaced = false;

  try {
    await copyWithMetadata(
      target,
      temporaryPath,
      metadata,
      options,
      fs.constants.COPYFILE_EXCL
    );
    await (options.chmod ?? fs.promises.chmod)(
      temporaryPath,
      metadata.mode | 0o200
    );

    await embedApplicationManifest(temporaryPath, manifestPath, options);

    const candidateManifest = await extractApplicationManifest(
      temporaryPath,
      options
    );
    validateCandidateManifest(manifestModel, candidateManifest, target);
    await applyMetadata(temporaryPath, metadata, options);

    await copyWithMetadata(
      target,
      backupPath,
      metadata,
      options,
      fs.constants.COPYFILE_EXCL
    );
    backupCreated = true;

    const replaceFile = options.replaceFile ?? fs.promises.rename;
    await replaceFile(temporaryPath, target);
    replaced = true;

    const installedManifest = await extractApplicationManifest(target, options);
    validateCandidateManifest(manifestModel, installedManifest, target);
    await applyMetadata(target, metadata, options);
    return target;
  } catch (error) {
    let rollbackError;
    if (
      backupCreated &&
      (replaced || !(await pathExists(target, options)))
    ) {
      try {
        await restoreBackup(target, backupPath, metadata, options);
      } catch (restoreError) {
        rollbackError = restoreError;
      }
    }

    if (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Executable preparation failed and rollback from ${backupPath} also failed.`
      );
    }
    throw new Error(
      `Executable preparation failed; the original remains at ${target}` +
        (backupCreated ? ` and its backup remains at ${backupPath}.` : '.'),
      { cause: error }
    );
  } finally {
    await fs.promises.rm(temporaryPath, { force: true });
  }
}

module.exports = {
  SIGNATURE_WARNING,
  checkElectronExecutable,
  prepareElectronExecutable,
};
