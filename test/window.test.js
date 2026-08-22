const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const {
  prepareElectronExecutable,
} = require('../dist/prepare');
const { runProcess } = require('./helpers/run-process');

async function runElectronFixture(fixture, timeoutMs = 45_000) {
  const electronExecutable = require('electron');
  assert.equal(typeof electronExecutable, 'string');
  assert.equal(await prepareElectronExecutable(), electronExecutable);

  return runProcess(electronExecutable, [path.join(__dirname, fixture)], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    timeoutMs,
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

test('repeatedly creates and tears down native-backed windows', async () => {
  const result = await runElectronFixture('lifecycle-stress-app.js', 90_000);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /LIFECYCLE_STRESS_READY:12/);
});
