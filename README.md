# Electron WinUI

`@microsoft/electron-winui` is an experimental Windows package that replaces an
Electron window's HTML chrome with a native WinUI 3 title area, menu bar,
flyouts, and dialogs while keeping the app's Chromium renderer, preload,
Node.js APIs, and IPC.

> [!WARNING]
> This is a preview for Electron 39. It implements a useful subset of
> `BrowserWindow`; it is not yet a universal drop-in replacement.

## Try the one-import migration

Install the package alongside Electron:

```powershell
npm install electron@39 @microsoft/electron-winui
npx electron-winui prepare
```

Change the Electron import in the **main process**:

```diff
- const { app, BrowserWindow, Menu, dialog } = require('electron');
+ const { app, BrowserWindow, Menu, dialog } =
+   require('@microsoft/electron-winui');
```

Renderer and preload imports remain unchanged:

```js
const { contextBridge, ipcRenderer } = require('electron');
```

Create and use the window normally:

```js
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: require('node:path').join(__dirname, 'preload.js'),
    },
    winui: {
      subtitle: 'MY ELECTRON APP',
    },
  });

  window.loadFile('index.html');
});
```

## How it works

Each `WinUIWindow` is a genuine native-backed Electron `BaseWindow` containing:

```text
Electron BaseWindow
├─ WinUI DesktopWindowXamlSource
│  ├─ native title content
│  ├─ MenuBar and flyouts
│  └─ ContentDialog
└─ WebContentsView
   └─ unchanged Chromium renderer
```

The package augments the native `BaseWindow` with `webContents`, `loadURL`,
`loadFile`, `reload`, `capturePage`, menu methods, and common `BrowserWindow`
static lookups.

## PerMonitorV2 preparation

WinUI 3 requires Per-Monitor V2 DPI awareness. Electron 39 declares Per-Monitor
V1 in its executable manifest. The development command patches Electron before
it starts:

```powershell
npx electron-winui prepare
```

For production, apply `prepareElectronExecutable(path)` to the packaged
executable **before code signing**:

```js
const {
  prepareElectronExecutable,
} = require('@microsoft/electron-winui');

await prepareElectronExecutable('out/MyApp-win32-x64/MyApp.exe');
```

Patching after signing invalidates the executable signature.

## Preview compatibility

Supported:

- `webContents`
- `loadFile`, `loadURL`, `reload`, `capturePage`
- normal `BaseWindow` bounds, show/hide, minimize/maximize, parent, and lifecycle
- `getAllWindows`, `fromId`, `fromWebContents`, and `getFocusedWindow`
- simple top-level Electron application menus
- asynchronous `dialog.showMessageBox`
- multiple explicit `WinUIWindow` instances

Not yet supported:

- complete `BrowserWindow` method/event parity
- `instanceof electron.BrowserWindow`
- automatic conversion of renderer `window.open()` windows
- synchronous WinUI message boxes
- nested/check/radio menu parity and all Electron menu roles
- transparent windows, fullscreen, and docked DevTools guarantees
- production support outside Electron 39

On macOS and Linux, the package exports Electron's normal `BrowserWindow`,
`Menu`, and `dialog`.

## Run the example

```powershell
npm install
npm run restore
npm run build
node dist/cli.js prepare
npm run example
```

## Build from source

This repository is the package root. From a clone:

```powershell
npm ci
npm run restore   # downloads Windows App SDK metadata into .winapp/
npm run generate  # regenerates WinRT JS bindings from package.json winapp config
npm run build     # emits dist/
npm test          # type check + Electron smoke tests
```

To produce a tarball, use the packaging script:

```powershell
./scripts/package-electron-winui.ps1 -OutputPath ./artifacts
```

`npm run restore`, `npm run generate`, and the `.winapp/` directory require the
[`winapp` CLI](https://www.npmjs.com/package/@microsoft/winappcli), which is
installed as a dev dependency. `.winapp/`, `dist/`, and `artifacts/` are
generated and are not committed.

See [`docs/winui-window.md`](docs/winui-window.md) for the standalone guide.

