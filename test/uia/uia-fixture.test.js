const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runProcess } = require('../helpers/run-process');

const SCRIPT_PATH = path.join(__dirname, 'run-uia-tests.ps1');
const RESULTS_JSON_PATH = path.join(
  __dirname,
  'artifacts',
  'test-results.json'
);
const OVERALL_TIMEOUT_MS = 180_000;

test('uia fixture: winapp ui scripted battery passes end-to-end', async () => {
  const result = await runProcess(
    'pwsh.exe',
    ['-NoLogo', '-NoProfile', '-File', SCRIPT_PATH],
    {
      cwd: path.resolve(__dirname, '..', '..'),
      env: process.env,
      timeoutMs: OVERALL_TIMEOUT_MS,
    }
  );

  if (result.code === 0) {
    return;
  }

  let resultsJson =
    '(test-results.json was not found - the script likely failed before it could write it)';
  try {
    resultsJson = fs.readFileSync(RESULTS_JSON_PATH, 'utf8');
  } catch {
    // Leave the placeholder message above.
  }

  assert.fail(
    [
      `run-uia-tests.ps1 exited ${result.code} (expected 0).`,
      '--- stdout ---',
      result.stdout || '(empty)',
      '--- stderr ---',
      result.stderr || '(empty)',
      '--- artifacts/test-results.json ---',
      resultsJson,
    ].join('\n\n')
  );
});
