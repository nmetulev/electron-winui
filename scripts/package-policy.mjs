export const validatedPackageBaseline = Object.freeze({
  commit: 'e2a78d905564a7468b3ca7c6a512feae805da7d5',
  packedSizeBytes: 1_974_952,
  unpackedSizeBytes: 16_706_609,
  fileCount: 1_422,
});

export const packageBudgets = Object.freeze({
  minimumPackedSizeBytes: 1_900_000,
  packedSizeBytes: 2_100_000,
  minimumUnpackedSizeBytes: 16_500_000,
  unpackedSizeBytes: 17_000_000,
  minimumFileCount: 1_400,
  fileCount: 1_450,
});

export const requiredPackageFiles = Object.freeze([
  'dist/index.js',
  'dist/index.d.ts',
  'dist/cli.js',
  'dist/electron-pmv2.manifest',
  'dist/windows-app-sdk.js',
  'dist/windows-app-sdk.runtime.json',
  'dist/bindings/index.js',
  'dist/runtime/x64/Microsoft.WindowsAppRuntime.Bootstrap.dll',
  'dist/runtime/arm64/Microsoft.WindowsAppRuntime.Bootstrap.dll',
]);

function parseJsonCandidate(candidate) {
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

export function parseNpmPackJson(output) {
  if (typeof output !== 'string' || output.trim() === '') {
    throw new Error('npm pack --json produced no JSON output.');
  }

  const trimmed = output.trim();
  let parsed = parseJsonCandidate(trimmed);
  if (!parsed) {
    const candidates = [];
    if (trimmed.startsWith('[')) {
      candidates.push(0);
    }
    for (
      let index = trimmed.lastIndexOf('\n[');
      index >= 0;
      index = trimmed.lastIndexOf('\n[', index - 1)
    ) {
      candidates.push(index + 1);
    }
    for (const index of candidates) {
      parsed = parseJsonCandidate(trimmed.slice(index));
      if (parsed) {
        break;
      }
    }
  }

  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error(
      'npm pack --json must report exactly one package. Remove stale package inputs and retry.'
    );
  }

  const [pack] = parsed;
  if (
    !pack ||
    !Number.isInteger(pack.size) ||
    !Number.isInteger(pack.unpackedSize) ||
    !Array.isArray(pack.files)
  ) {
    throw new Error(
      'npm pack --json omitted size, unpackedSize, or files metadata. Use the repository lockfile npm version and retry.'
    );
  }

  return pack;
}

function formatBytes(bytes) {
  return `${bytes.toLocaleString('en-US')} ${bytes === 1 ? 'byte' : 'bytes'}`;
}

function overBudget(name, actual, maximum, formatter = String) {
  const overage = actual - maximum;
  return (
    `${name} is ${formatter(actual)}; limit is ${formatter(maximum)} ` +
    `(over by ${formatter(overage)}).`
  );
}

function underBudget(name, actual, minimum, formatter = String) {
  const underage = minimum - actual;
  return (
    `${name} is ${formatter(actual)}; minimum is ${formatter(minimum)} ` +
    `(under by ${formatter(underage)}).`
  );
}

export function verifyPackagePolicy(
  pack,
  {
    budgets = packageBudgets,
    requiredFiles = requiredPackageFiles,
  } = {}
) {
  const errors = [];
  const filePaths = new Set(pack.files.map((file) => file?.path));

  for (const requiredFile of requiredFiles) {
    if (!filePaths.has(requiredFile)) {
      errors.push(`required artifact is missing from the tarball: ${requiredFile}.`);
    }
  }

  if (pack.size < budgets.minimumPackedSizeBytes) {
    errors.push(
      underBudget(
        'packed size',
        pack.size,
        budgets.minimumPackedSizeBytes,
        formatBytes
      )
    );
  }
  if (pack.size > budgets.packedSizeBytes) {
    errors.push(
      overBudget(
        'packed size',
        pack.size,
        budgets.packedSizeBytes,
        formatBytes
      )
    );
  }
  if (pack.unpackedSize < budgets.minimumUnpackedSizeBytes) {
    errors.push(
      underBudget(
        'unpacked size',
        pack.unpackedSize,
        budgets.minimumUnpackedSizeBytes,
        formatBytes
      )
    );
  }
  if (pack.unpackedSize > budgets.unpackedSizeBytes) {
    errors.push(
      overBudget(
        'unpacked size',
        pack.unpackedSize,
        budgets.unpackedSizeBytes,
        formatBytes
      )
    );
  }
  if (pack.files.length < budgets.minimumFileCount) {
    errors.push(
      underBudget(
        'file count',
        pack.files.length,
        budgets.minimumFileCount
      )
    );
  }
  if (pack.files.length > budgets.fileCount) {
    errors.push(
      overBudget('file count', pack.files.length, budgets.fileCount)
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Package policy rejected ${pack.filename ?? pack.name ?? 'the npm tarball'}:\n` +
        errors.map((error) => `- ${error}`).join('\n') +
        '\nRestore missing files, remove unintended files, or update the reviewed baseline and budgets in scripts/package-policy.mjs.'
    );
  }

  return {
    filename: pack.filename,
    packedSizeBytes: pack.size,
    unpackedSizeBytes: pack.unpackedSize,
    fileCount: pack.files.length,
  };
}
