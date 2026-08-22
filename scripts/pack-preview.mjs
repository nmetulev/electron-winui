import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseNpmPackJson,
  verifyPackagePolicy,
} from './package-policy.mjs';

function parseArguments(arguments_) {
  let destination =
    process.env.ELECTRON_WINUI_PACK_DESTINATION ?? process.cwd();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--pack-destination') {
      destination = arguments_[index + 1];
      index += 1;
    } else if (argument.startsWith('--pack-destination=')) {
      destination = argument.slice('--pack-destination='.length);
    } else {
      throw new Error(
        `Unknown argument "${argument}". Use --pack-destination <directory>.`
      );
    }
  }
  if (!destination) {
    throw new Error('--pack-destination requires a directory.');
  }
  return path.resolve(destination);
}

const destination = parseArguments(process.argv.slice(2));
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error(
    'npm CLI path is unavailable. Run this command through `npm run pack:preview`.'
  );
}

fs.mkdirSync(destination, { recursive: true });
const stagingDirectory = fs.mkdtempSync(
  path.join(destination, '.electron-winui-pack-')
);

try {
  const result = spawnSync(
    process.execPath,
    [npmCli, 'pack', '--json', '--pack-destination', stagingDirectory],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: process.env,
    }
  );

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    process.exitCode = result.status ?? 1;
  } else {
    const pack = parseNpmPackJson(result.stdout);
    const summary = verifyPackagePolicy(pack);
    const stagedTarball = path.join(stagingDirectory, summary.filename);
    const tarball = path.join(destination, summary.filename);
    if (!fs.existsSync(stagedTarball)) {
      throw new Error(
        `npm pack reported ${summary.filename}, but it was not created.`
      );
    }
    if (fs.existsSync(tarball)) {
      throw new Error(
        `Refusing to overwrite existing release candidate ${tarball}. Remove it and retry.`
      );
    }
    fs.renameSync(stagedTarball, tarball);
    console.log(
      `Verified ${summary.filename}: ${summary.packedSizeBytes.toLocaleString('en-US')} packed bytes, ` +
        `${summary.unpackedSizeBytes.toLocaleString('en-US')} unpacked bytes, ${summary.fileCount} files.`
    );
    console.log(`Tarball: ${tarball}`);
  }
} finally {
  fs.rmSync(stagingDirectory, { recursive: true, force: true });
}
