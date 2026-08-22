const assert = require('node:assert/strict');
const { test } = require('node:test');

const policyPromise = import('../scripts/package-policy.mjs');

function packResult(requiredFiles, overrides = {}) {
  return {
    name: 'electron-winui',
    filename: 'electron-winui-0.1.0-preview.1.tgz',
    size: 1_974_952,
    unpackedSize: 16_706_609,
    files: requiredFiles.map((path) => ({ path, size: 1 })),
    ...overrides,
  };
}

test('parses npm pack JSON after lifecycle output', async () => {
  const { parseNpmPackJson } = await policyPromise;
  const output = [
    '> electron-winui@0.1.0-preview.1 prepack',
    '> npm run build',
    '',
    JSON.stringify([packResult([])]),
  ].join('\n');

  assert.equal(parseNpmPackJson(output).size, 1_974_952);
});

test('accepts the validated package baseline', async () => {
  const {
    requiredPackageFiles,
    validatedPackageBaseline,
    verifyPackagePolicy,
  } = await policyPromise;
  const result = verifyPackagePolicy(
    packResult(requiredPackageFiles, {
      size: validatedPackageBaseline.packedSizeBytes,
      unpackedSize: validatedPackageBaseline.unpackedSizeBytes,
      files: [
        ...requiredPackageFiles.map((path) => ({ path, size: 1 })),
        ...Array.from(
          {
            length:
              validatedPackageBaseline.fileCount -
              requiredPackageFiles.length,
          },
          (_, index) => ({ path: `dist/generated/${index}.js`, size: 1 })
        ),
      ],
    })
  );

  assert.equal(result.fileCount, validatedPackageBaseline.fileCount);
});

test('reports every package policy violation actionably', async () => {
  const {
    packageBudgets,
    requiredPackageFiles,
    verifyPackagePolicy,
  } = await policyPromise;
  const files = Array.from(
    { length: packageBudgets.fileCount + 1 },
    (_, index) => ({ path: `dist/generated/${index}.js`, size: 1 })
  );
  files.push(
    ...requiredPackageFiles
      .slice(1)
      .map((path) => ({ path, size: 1 }))
  );

  assert.throws(
    () =>
      verifyPackagePolicy(
        packResult(requiredPackageFiles, {
          size: packageBudgets.packedSizeBytes + 1,
          unpackedSize: packageBudgets.unpackedSizeBytes + 1,
          files,
        })
      ),
    (error) => {
      assert.match(error.message, /required artifact is missing.*dist\/index\.js/);
      assert.match(error.message, /packed size.*over by 1 byte/);
      assert.match(error.message, /unpacked size.*over by 1 byte/);
      assert.match(error.message, /file count.*over by/);
      assert.match(error.message, /update the reviewed baseline and budgets/);
      return true;
    }
  );
});
