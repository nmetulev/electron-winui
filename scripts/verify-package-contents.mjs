import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  'dist/index.js',
  'dist/index.d.ts',
  'dist/cli.js',
  'dist/electron-pmv2.manifest',
  'dist/bindings/index.js',
  'dist/runtime/x64/Microsoft.WindowsAppRuntime.Bootstrap.dll',
  'dist/runtime/arm64/Microsoft.WindowsAppRuntime.Bootstrap.dll',
];

const missing = requiredFiles.filter(
  (relativePath) => !fs.existsSync(path.join(packageRoot, relativePath))
);

if (missing.length > 0) {
  throw new Error(
    `Package is incomplete. Missing required files:\n${missing
      .map((file) => `- ${file}`)
      .join('\n')}`
  );
}

console.log(`Verified ${requiredFiles.length} required package artifacts.`);
