import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requiredPackageFiles } from './package-policy.mjs';
import { resolveWindowsAppSdkContract } from './windows-app-sdk.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const missing = requiredPackageFiles.filter(
  (relativePath) => !fs.existsSync(path.join(packageRoot, relativePath))
);

if (missing.length > 0) {
  throw new Error(
    `Package is incomplete. Missing required files:\n${missing
      .map((file) => `- ${file}`)
      .join('\n')}`
  );
}

const expectedContract = resolveWindowsAppSdkContract({ packageRoot });
const contractPath = path.join(
  packageRoot,
  'dist',
  'windows-app-sdk.runtime.json'
);
let packagedContract;
try {
  packagedContract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
} catch (error) {
  throw new Error(
    `Package runtime contract is invalid JSON at ${contractPath}.`,
    { cause: error }
  );
}

if (
  packagedContract?.packageVersion !== expectedContract.packageVersion ||
  packagedContract?.release?.major !== expectedContract.major ||
  packagedContract?.release?.minor !== expectedContract.minor
) {
  throw new Error(
    'Package runtime contract does not match the effective Windows App SDK build contract.'
  );
}

console.log(`Verified ${requiredPackageFiles.length} required package artifacts.`);
