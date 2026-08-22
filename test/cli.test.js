const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const { main, parseArguments } = require('../src/cli');

afterEach(() => {
  process.exitCode = undefined;
});

test('parses check, dry-run, signing, and backup options', () => {
  assert.deepEqual(
    parseArguments([
      'prepare',
      '--dry-run',
      '--allow-signed',
      '--backup',
      'saved.exe',
      'app.exe',
    ]),
    {
      command: 'prepare',
      options: {
        allowSigned: true,
        backupPath: 'saved.exe',
        check: false,
        dryRun: true,
        executablePath: 'app.exe',
      },
    }
  );
  assert.throws(
    () => parseArguments(['prepare', '--check', '--dry-run']),
    /either --check or --dry-run/
  );
  assert.throws(
    () => parseArguments(['prepare', '--backup', '--dry-run', 'app.exe']),
    /--backup option requires a path/
  );
});

test('check mode reports non-compliance with a distinct exit code', async () => {
  const output = [];
  let prepared = false;
  await main(['prepare', '--check', 'app.exe'], {
    checkElectronExecutable: async (executablePath) => ({
      backupPath: null,
      backupRetained: false,
      compliant: false,
      executablePath,
      signatureStatus: 'unsigned',
      supported: true,
      warnings: [],
      wouldModify: true,
    }),
    output: (message) => output.push(message),
    prepareElectronExecutable: async () => {
      prepared = true;
    },
  });

  assert.equal(process.exitCode, 2);
  assert.equal(prepared, false);
  assert.match(output.join('\n'), /Not compliant/);
});

test('dry-run reports the backup without preparing', async () => {
  const output = [];
  await main(['prepare', '--dry-run', 'app.exe'], {
    checkElectronExecutable: async (executablePath) => ({
      backupPath: `${executablePath}.backup`,
      backupRetained: true,
      compliant: false,
      executablePath,
      signatureStatus: 'valid',
      supported: true,
      warnings: ['sign after preparation'],
      wouldModify: true,
    }),
    output: (message) => output.push(message),
    prepareElectronExecutable: async () => {
      throw new Error('must not prepare');
    },
  });

  assert.equal(process.exitCode, undefined);
  assert.match(output.join('\n'), /Would patch/);
  assert.match(output.join('\n'), /retain the original/);
  assert.match(output.join('\n'), /Warning: sign after preparation/);
});

test('dry-run reports operation-scoped rollback by default', async () => {
  const output = [];
  await main(['prepare', '--dry-run', 'app.exe'], {
    checkElectronExecutable: async (executablePath) => ({
      backupPath: null,
      backupRetained: false,
      compliant: false,
      executablePath,
      signatureStatus: 'unsigned',
      supported: true,
      warnings: [],
      wouldModify: true,
    }),
    output: (message) => output.push(message),
  });

  assert.match(output.join('\n'), /operation-scoped rollback copy/);
  assert.match(output.join('\n'), /remove it after validation/);
});
