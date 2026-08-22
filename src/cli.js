#!/usr/bin/env node

const path = require('node:path');
const {
  checkElectronExecutable,
  prepareElectronExecutable,
} = require('./prepare');

const USAGE =
  'Usage: electron-winui prepare [--check | --dry-run] [--allow-signed] ' +
  '[--backup <path>] [path-to-electron.exe]';

function findElectronExecutable(argument, dependencies = {}) {
  if (argument) {
    return path.resolve(argument);
  }

  const electron = dependencies.electron ?? require('electron');
  if (typeof electron !== 'string') {
    throw new Error(
      'Could not infer Electron executable path. Pass it explicitly to `electron-winui prepare <path>`.'
    );
  }
  return electron;
}

function parseArguments(arguments_) {
  const [command, ...values] = arguments_;
  const options = {
    allowSigned: false,
    backupPath: undefined,
    check: false,
    dryRun: false,
    executablePath: undefined,
  };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--check') {
      options.check = true;
    } else if (value === '--dry-run') {
      options.dryRun = true;
    } else if (value === '--allow-signed') {
      options.allowSigned = true;
    } else if (value === '--backup') {
      options.backupPath = values[++index];
      if (!options.backupPath || options.backupPath.startsWith('-')) {
        throw new Error('The --backup option requires a path.');
      }
    } else if (value.startsWith('-')) {
      throw new Error(`Unknown option: ${value}`);
    } else if (options.executablePath) {
      throw new Error('Only one executable path can be prepared.');
    } else {
      options.executablePath = value;
    }
  }

  if (options.check && options.dryRun) {
    throw new Error('Use either --check or --dry-run, not both.');
  }
  return { command, options };
}

function printReport(report, output) {
  output(
    `${report.compliant ? 'Compliant' : 'Not compliant'}: ${report.executablePath}`
  );
  output(`Signature: ${report.signatureStatus}`);
  if (report.wouldModify) {
    output(
      report.backupRetained
        ? `Backup: retain the original at ${report.backupPath}`
        : 'Rollback: operation-scoped copy removed after successful validation'
    );
  }
  for (const warning of report.warnings) {
    output(`Warning: ${warning}`);
  }
}

async function main(arguments_ = process.argv.slice(2), dependencies = {}) {
  const { command, options } = parseArguments(arguments_);
  const output = dependencies.output ?? console.log;
  if (command !== 'prepare') {
    output(USAGE);
    if (command) {
      process.exitCode = 1;
    }
    return;
  }

  const executablePath = findElectronExecutable(
    options.executablePath,
    dependencies
  );
  const apiOptions = {
    allowSigned: options.allowSigned,
    backupPath: options.backupPath,
  };
  const check =
    dependencies.checkElectronExecutable ?? checkElectronExecutable;
  const prepare =
    dependencies.prepareElectronExecutable ?? prepareElectronExecutable;
  const report = await check(executablePath, apiOptions);
  printReport(report, output);

  if (options.check) {
    if (!report.compliant) {
      process.exitCode = 2;
    }
    return;
  }
  if (options.dryRun) {
    output(
      report.wouldModify
        ? report.backupRetained
          ? `Would patch and retain the original at ${report.backupPath}.`
          : 'Would patch with an operation-scoped rollback copy and remove it after validation.'
        : 'No changes would be made.'
    );
    return;
  }
  if (report.compliant) {
    output('No changes were made.');
    return;
  }

  const patched = await prepare(executablePath, apiOptions);
  output(`Applied and validated PerMonitorV2 manifest: ${patched}`);
  output(
    report.backupRetained
      ? `Original executable retained at: ${report.backupPath}`
      : 'Operation-scoped rollback copy removed after validation.'
  );
  output('Sign the prepared executable after this step.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  USAGE,
  main,
  parseArguments,
};
