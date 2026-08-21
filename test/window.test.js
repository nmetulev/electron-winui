const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const {
  prepareElectronExecutable,
} = require('../dist/prepare');

async function runElectronFixture(fixture) {
  const electronExecutable = require('electron');
  assert.equal(typeof electronExecutable, 'string');
  assert.equal(await prepareElectronExecutable(), electronExecutable);

  return new Promise((resolve, reject) => {
    const child = spawn(
      electronExecutable,
      [path.join(__dirname, fixture)],
      {
        cwd: path.resolve(__dirname, '..'),
        env: {
          ...process.env,
          ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stderr, stdout }));
  });
}

test('creates a native-backed WinUIWindow with Chromium content', async () => {
  const result = await runElectronFixture('smoke-app.js');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /WINUI_WINDOW_READY:\d+/);
});

test('keeps the shared WinUI runtime alive across windows', async () => {
  const result = await runElectronFixture('multi-window-app.js');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /MULTI_WINDOW_READY/);
});
