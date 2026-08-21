const { spawn } = require('node:child_process');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const WINDOWS_TIMEOUT_MARKER = '__ELECTRON_WINUI_PROCESS_TIMEOUT__';

function commandText(command, args) {
  return [command, ...args].join(' ');
}

function appendOutput(current, chunk) {
  const next = current + chunk;
  return next.length <= MAX_OUTPUT_BYTES
    ? next
    : next.slice(next.length - MAX_OUTPUT_BYTES);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    timeout.unref();
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function terminateProcessTree(child) {
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn(
        'taskkill.exe',
        ['/pid', String(child.pid), '/t', '/f'],
        { stdio: 'ignore', windowsHide: true }
      );
      killer.once('error', resolve);
      killer.once('exit', resolve);
    });
  } else if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
  }

  await waitForExit(child, 2_000);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await waitForExit(child, 2_000);
  }
}

function failureDetails(label, stdout, stderr) {
  return [
    label,
    stdout ? `stdout:\n${stdout.trimEnd()}` : 'stdout: <empty>',
    stderr ? `stderr:\n${stderr.trimEnd()}` : 'stderr: <empty>',
  ].join('\n');
}

function runProcess(
  command,
  args = [],
  {
    cwd,
    env = process.env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    windowsHide = true,
  } = {}
) {
  return new Promise((resolve, reject) => {
    const spawnCommand =
      process.platform === 'win32' ? 'pwsh.exe' : command;
    const spawnArguments =
      process.platform === 'win32'
        ? [
            '-NoLogo',
            '-NoProfile',
            '-File',
            path.join(__dirname, 'windows-job-runner.ps1'),
            process.execPath,
            path.join(__dirname, 'windows-process-launcher.js'),
            Buffer.from(JSON.stringify({ command, args }), 'utf8').toString(
              'base64'
            ),
            String(timeoutMs),
          ]
        : args;
    const child = spawn(spawnCommand, spawnArguments, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError;
    let settled = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.once('error', (error) => {
      spawnError = error;
    });

    function settle(action) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      action();
    }

    const watchdogMs =
      process.platform === 'win32' ? timeoutMs + 15_000 : timeoutMs;
    const timer = setTimeout(async () => {
      timedOut = true;
      await terminateProcessTree(child);
      child.stdout.destroy();
      child.stderr.destroy();
      const displayCommand = commandText(command, args);
      settle(() =>
        reject(
          new Error(
            failureDetails(
              `Process timed out after ${timeoutMs} ms and was terminated: ${displayCommand}`,
              stdout,
              stderr
            )
          )
        )
      );
    }, watchdogMs);
    timer.unref();

    child.once('close', (code, signal) => {
      if (timedOut) {
        return;
      }
      const displayCommand = commandText(command, args);
      if (spawnError) {
        settle(() =>
          reject(
            new Error(
              failureDetails(
                `Failed to start process: ${displayCommand}\n${spawnError.message}`,
                stdout,
                stderr
              ),
              { cause: spawnError }
            )
          )
        );
        return;
      }
      const windowsTimeout = stderr.match(
        new RegExp(`${WINDOWS_TIMEOUT_MARKER}(\\d+)`)
      );
      if (windowsTimeout) {
        stderr = stderr
          .replace(new RegExp(`${WINDOWS_TIMEOUT_MARKER}\\d+\\r?\\n?`), '')
          .trimStart();
        settle(() =>
          reject(
            new Error(
              failureDetails(
                `Process timed out after ${windowsTimeout[1]} ms and was terminated: ${displayCommand}`,
                stdout,
                stderr
              )
            )
          )
        );
        return;
      }
      settle(() => resolve({ code, signal, stderr, stdout }));
    });
  });
}

module.exports = {
  runProcess,
  terminateProcessTree,
};
