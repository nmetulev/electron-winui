import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertRestoredWindowsAppSdk,
  findBootstrapDll,
  resolveWindowsAppSdkContract,
  runtimeContractJson,
} from './windows-app-sdk.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(packageRoot, 'dist');
const bindingsDir = path.join(packageRoot, '.winapp', 'bindings');
const windowsAppSdk = resolveWindowsAppSdkContract({ packageRoot });
const restoreMetadata = assertRestoredWindowsAppSdk(
  packageRoot,
  windowsAppSdk
);

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

for (const arch of ['arm64', 'x64']) {
  const source = findBootstrapDll(
    arch,
    windowsAppSdk,
    restoreMetadata
  );

  const runtimeDir = path.join(distDir, 'runtime', arch);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.copyFileSync(
    source,
    path.join(runtimeDir, 'Microsoft.WindowsAppRuntime.Bootstrap.dll')
  );
}

fs.writeFileSync(
  path.join(distDir, 'windows-app-sdk.runtime.json'),
  runtimeContractJson(windowsAppSdk)
);

console.log(
  `Built ${path.relative(packageRoot, distDir)} with Windows App SDK ${windowsAppSdk.packageVersion}`
);
