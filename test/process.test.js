const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { runProcess } = require('./helpers/run-process');

test('captures process output and exit status', async () => {
  const result = await runProcess(
    process.execPath,
    ['-e', "console.log('ready'); console.error('diagnostic'); process.exit(3)"],
    { timeoutMs: 5_000 }
  );

  assert.equal(result.code, 3);
  assert.equal(result.stdout.trim(), 'ready');
  assert.equal(result.stderr.trim(), 'diagnostic');
});

test('times out, terminates, and reports captured diagnostics', async () => {
  await assert.rejects(
    runProcess(
      process.execPath,
      [
        '-e',
        "console.log('fixture started'); console.error('fixture waiting'); setInterval(() => {}, 1000)",
      ],
      { timeoutMs: 250 }
    ),
    (error) => {
      assert.match(error.message, /Process timed out after 250 ms and was terminated/);
      assert.match(error.message, /stdout:\nfixture started/);
      assert.match(error.message, /stderr:\nfixture waiting/);
      return true;
    }
  );
});

test('does not leak descendants after the root process exits', {
  skip: process.platform !== 'win32',
}, async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'electron-winui-process-tree-')
  );
  const marker = path.join(directory, 'descendant-survived');
  try {
    const script = [
      "const { spawn } = require('node:child_process');",
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(
        `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(
          marker
        )}, 'survived'), 500)`
      )}], { detached: true, stdio: 'inherit' });`,
      'child.unref();',
    ].join(' ');
    const result = await runProcess(process.execPath, ['-e', script], {
      timeoutMs: 5_000,
    });
    assert.equal(result.code, 0, result.stderr);
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});
