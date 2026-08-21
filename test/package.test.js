const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { runProcess } = require('./helpers/run-process');

const packageRoot = path.resolve(__dirname, '..');
const npmCli = process.env.npm_execpath;

function assertSucceeded(result, operation) {
  assert.equal(
    result.code,
    0,
    `${operation} failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
}

test('packs, installs, and executes the actual npm tarball', async () => {
  assert.ok(npmCli, 'npm_execpath must identify the npm CLI entry point');
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'electron-winui-consumer-')
  );
  const packDirectory = path.join(temporaryDirectory, 'pack');
  const consumerDirectory = path.join(temporaryDirectory, 'consumer');
  fs.mkdirSync(packDirectory);
  fs.mkdirSync(consumerDirectory);

  try {
    let tarball = process.env.ELECTRON_WINUI_TARBALL;
    if (!tarball) {
      const pack = await runProcess(
        process.execPath,
        [npmCli, 'pack', '--json', '--pack-destination', packDirectory],
        { cwd: packageRoot, timeoutMs: 120_000 }
      );
      assertSucceeded(pack, 'npm pack');
      const filename = pack.stdout.match(/"filename"\s*:\s*"([^"]+)"/)?.[1];
      assert.ok(filename, `npm pack did not report a tarball filename:\n${pack.stdout}`);
      tarball = path.join(packDirectory, filename);
    }
    tarball = path.resolve(tarball);
    assert.equal(fs.existsSync(tarball), true);

    const install = await runProcess(
      process.execPath,
      [
        npmCli,
        'install',
        tarball,
        '--omit=peer',
        '--no-audit',
        '--no-fund',
      ],
      { cwd: consumerDirectory, timeoutMs: 120_000 }
    );
    assertSucceeded(install, 'consumer npm install');

    const consume = await runProcess(
      process.execPath,
      [
        '-e',
        [
          "const assert = require('node:assert/strict');",
          "const fs = require('node:fs');",
          "const path = require('node:path');",
          "const root = path.dirname(require.resolve('electron-winui/package.json'));",
          "const prepare = require('electron-winui/dist/prepare');",
          "assert.equal(prepare.hasPerMonitorV2Manifest('ignored', { readFileSync: () => Buffer.from('PerMonitorV2') }), true);",
          "for (const arch of ['x64', 'arm64']) {",
          "  assert.equal(fs.existsSync(path.join(root, 'dist', 'runtime', arch, 'Microsoft.WindowsAppRuntime.Bootstrap.dll')), true);",
          "}",
          "console.log('PACKED_CONSUMER_READY');",
        ].join(' '),
      ],
      { cwd: consumerDirectory, timeoutMs: 10_000 }
    );
    assertSucceeded(consume, 'installed package execution');
    assert.match(consume.stdout, /PACKED_CONSUMER_READY/);

    const cli = await runProcess(
      process.execPath,
      [path.join(consumerDirectory, 'node_modules', 'electron-winui', 'dist', 'cli.js')],
      { cwd: consumerDirectory, timeoutMs: 10_000 }
    );
    assertSucceeded(cli, 'installed CLI execution');
    assert.match(cli.stdout, /Usage: electron-winui prepare/);
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});
