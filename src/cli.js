#!/usr/bin/env node

const path = require('node:path');
const {
  hasPerMonitorV2Manifest,
  prepareElectronExecutable,
} = require('./prepare');

function findElectronExecutable(argument) {
  if (argument) {
    return path.resolve(argument);
  }

  const electron = require('electron');
  if (typeof electron !== 'string') {
    throw new Error(
      'Could not infer Electron executable path. Pass it explicitly to `electron-winui prepare <path>`.'
    );
  }
  return electron;
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  if (command !== 'prepare') {
    console.log('Usage: electron-winui prepare [path-to-electron.exe]');
    process.exitCode = command ? 1 : 0;
    return;
  }

  const executablePath = findElectronExecutable(argument);
  if (hasPerMonitorV2Manifest(executablePath)) {
    console.log(`Electron already uses PerMonitorV2: ${executablePath}`);
    return;
  }

  const patched = await prepareElectronExecutable(executablePath);
  console.log(`Applied PerMonitorV2 manifest: ${patched}`);
  console.log('Patch packaged executables before code signing as well.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
