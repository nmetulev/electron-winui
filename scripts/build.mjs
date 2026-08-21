import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(packageRoot, 'dist');
const bindingsDir = path.join(packageRoot, '.winapp', 'bindings');

if (!fs.existsSync(path.join(bindingsDir, 'index.js'))) {
  throw new Error(
    'Generated WinRT bindings were not found. Run `npm run restore` before `npm run build`.'
  );
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

for (const entry of fs.readdirSync(path.join(packageRoot, 'src'))) {
  fs.copyFileSync(
    path.join(packageRoot, 'src', entry),
    path.join(distDir, entry)
  );
}

const packagedBindingsDir = path.join(distDir, 'bindings');
fs.mkdirSync(packagedBindingsDir, { recursive: true });
for (const entry of fs.readdirSync(bindingsDir)) {
  if (entry.endsWith('.js')) {
    fs.copyFileSync(
      path.join(bindingsDir, entry),
      path.join(packagedBindingsDir, entry)
    );
  }
}
fs.copyFileSync(
  path.join(packageRoot, 'types', 'index.d.ts'),
  path.join(distDir, 'index.d.ts')
);
fs.copyFileSync(
  path.join(packageRoot, 'electron-pmv2.manifest'),
  path.join(distDir, 'electron-pmv2.manifest')
);

const runtimeVersion = '2.1.0';
const nugetRoot = path.join(
  process.env.NUGET_PACKAGES ??
    path.join(process.env.USERPROFILE ?? '', '.nuget', 'packages'),
  'microsoft.windowsappsdk.foundation'
);

function nugetBootstrapCandidates(arch) {
  if (!fs.existsSync(nugetRoot)) {
    return [];
  }

  // Prefer the pinned version, then fall back to any other restored version so
  // a clean CI restore is not tied to one exact Windows App SDK build.
  const versions = fs
    .readdirSync(nugetRoot)
    .sort((a, b) => (a === runtimeVersion ? -1 : b === runtimeVersion ? 1 : 0));

  return versions.map((version) =>
    path.join(
      nugetRoot,
      version,
      'runtimes',
      `win-${arch}`,
      'native',
      'Microsoft.WindowsAppRuntime.Bootstrap.dll'
    )
  );
}

for (const arch of ['arm64', 'x64']) {
  const candidates = [
    path.join(
      packageRoot,
      '.winapp',
      'bin',
      arch,
      'Microsoft.WindowsAppRuntime.Bootstrap.dll'
    ),
    ...nugetBootstrapCandidates(arch),
  ];
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) {
    throw new Error(
      `Windows App SDK bootstrap DLL was not found for ${arch}. Run \`npm run restore\` before \`npm run build\`.`
    );
  }

  const runtimeDir = path.join(distDir, 'runtime', arch);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.copyFileSync(
    source,
    path.join(runtimeDir, 'Microsoft.WindowsAppRuntime.Bootstrap.dll')
  );
}

console.log(`Built ${path.relative(packageRoot, distDir)}`);
