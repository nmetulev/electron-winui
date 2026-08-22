# Electron WinUI

`electron-winui` is an experimental project that replaces Electron's native UI with WinUI, including WinUI TitleBar, WinUI menu bar, flyouts, and dialogs while keeping the app's Chromium renderer, preload, Node.js APIs, and IPC.

> [!WARNING]
> This is a experimental and only tested with Electron 43. It implements a useful subset of
> `BrowserWindow`; it is not a universal drop-in replacement.

https://github.com/user-attachments/assets/f147160e-484b-4675-9bea-ece68e6d5885

## Create a WinUI window

Install the package alongside Electron:

```powershell
npm install electron@43 electron-winui
npx electron-winui prepare
```

Import `WinUIWindow` explicitly in the **main process**. The package continues
to export Electron's original `BrowserWindow` unchanged.

```js
const { app, WinUIWindow, Menu, dialog } =
  require('electron-winui');
```

Renderer and preload imports remain unchanged:

```js
const { contextBridge, ipcRenderer } = require('electron');
```

Create and use the window normally:

```js
app.whenReady().then(() => {
  const window = new WinUIWindow({
    width: 1100,
    height: 760,
    winui: {
      icon: require('node:path').join(__dirname, 'icon.svg'),
      subtitle: 'MY WINUI APP',
    },
    webPreferences: {
      preload: require('node:path').join(__dirname, 'preload.js'),
    },
  });

  window.loadFile('index.html');
});
```

The titlebar identity can also change at runtime:

```js
window.setSubtitle('PROJECT ALPHA');
window.setTitleBarIcon('assets/project.svg');
```

The example's **Title bar** menu switches between two icon/subtitle pairs.

Add an optional native search box and handle its window events:

```js
const window = new WinUIWindow({
  winui: {
    searchBox: {
      placeholder: 'Search this project',
      width: 320,
    },
  },
});

window.on('titlebar-search-changed', (text) => {
  console.log('Typing:', text);
});
window.on('titlebar-search-submitted', (query) => {
  console.log('Submitted:', query);
});
```

Use `setTitleBarSearch(options)` to show or update it and
`setTitleBarSearch(null)` to hide it.

## How it works

Each `WinUIWindow` is a genuine native-backed Electron `BaseWindow` containing:

```text
Electron BaseWindow
├─ native Windows/AppWindow titlebar
├─ WinUI title DesktopWindowXamlSource
│  └─ title content and ContentDialog host
├─ WinUI menu DesktopWindowXamlSource
│  └─ full-width MenuBar and flyouts
├─ transient WinUI context DesktopWindowXamlSource
│  └─ context menus and web-area flyout dismissal
└─ WebContentsView
   └─ unchanged Chromium renderer
```

The package augments the native `BaseWindow` with `webContents`, `loadURL`,
`loadFile`, `reload`, `capturePage`, menu methods, and common `BrowserWindow`
static lookups.

## Theme the native shell and renderer

Set Electron's `nativeTheme.themeSource`, pass the same source to the window,
and notify the renderer so its CSS can follow the effective theme:

```js
function setTheme(source) {
  nativeTheme.themeSource = source;
  window.setTheme(source);
  window.webContents.send('theme-changed', {
    source,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
  });
}
```

The example includes System, Light, and Dark controls that update the native
titlebar, WinUI menus and dialogs, and Chromium content together.

## Show a native context menu

Menus created through this package keep Electron's `popup` shape. For a
`WinUIWindow`, the menu is rendered as a native WinUI `MenuFlyout`:

```js
const contextMenu = Menu.buildFromTemplate([
  { label: 'Show native dialog', click: showDialog },
  { type: 'separator' },
  { label: 'Use dark theme', click: () => setTheme('dark') },
]);

window.webContents.on('context-menu', (_event, params) => {
  contextMenu.popup({ window, x: params.x, y: params.y });
});
```

This preview supports visible flat items and separators in native context
menus. Other Electron windows continue to use Electron's normal popup path.

## PerMonitorV2 preparation

WinUI 3 requires Per-Monitor V2 DPI awareness. Electron declares Per-Monitor
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
} = require('electron-winui');

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
- configurable titlebar icon, subtitle, and search box
- asynchronous `dialog.showMessageBox`
- multiple explicit `WinUIWindow` instances

Not yet supported:

- complete `BrowserWindow` method/event parity
- `instanceof electron.BrowserWindow`
- automatic conversion of renderer `window.open()` windows
- synchronous WinUI message boxes
- nested/check/radio menu parity and all Electron menu roles
- transparent windows, fullscreen, and docked DevTools guarantees
- production support outside Electron 43

On macOS and Linux, `WinUIWindow` aliases Electron's normal `BrowserWindow`.

## Run the example

```powershell
npm install
npm run restore
npm run build
node dist/cli.js prepare
npm run example
```

## Build from source

This repository is the package root. Use Node.js 22.12 or newer. From a clone:

```powershell
npm ci
npm run restore   # downloads Windows App SDK metadata into .winapp/
npm run generate  # regenerates WinRT JS bindings from package.json winapp config
npm run build     # emits dist/
npm test          # unit + Electron smoke + packed-consumer tests
```

`npm pack` runs the build and rejects incomplete package contents before writing
a tarball. To produce a release tarball, use the packaging script:

```powershell
./scripts/package-electron-winui.ps1 -OutputPath ./artifacts
```

`npm run restore`, `npm run generate`, and the `.winapp/` directory require the
[`winapp` CLI](https://www.npmjs.com/package/@microsoft/winappcli), which is
installed as a dev dependency. `.winapp/`, `dist/`, and `artifacts/` are
generated and are not committed.

### Windows App SDK version contract

The `Microsoft.WindowsAppSDK` pin in `winapp.yaml` is the package-owned default
for restore, generated bindings, build, packaging, and runtime bootstrap. The
build validates `.winapp/winmds.lock.json` against that pin, copies only a
matching bootstrap DLL, and embeds the resolved major/minor release in `dist`.

For an explicit developer override, set
`ELECTRON_WINUI_WINAPPSDK_VERSION` to a full NuGet version for every command:

```powershell
$env:ELECTRON_WINUI_WINAPPSDK_VERSION = '2.1.0'
npm run restore
npm run generate
npm run build
```

This override rebuilds the electron-winui package itself; downstream app-level
runtime selection belongs to deployment integration. The override never changes
`winapp.yaml`. Production runtime does not honor
`WINAPPSDK_BOOTSTRAP_DLL_PATH`; it always loads the package-owned bootstrap DLL
selected and validated during the build. Runtime initialization is idempotent
when the process package graph already selected the same major/minor release.
If the Electron host or another dependency selected a different release first,
electron-winui fails with the required release instead of attempting to replace
the process-wide package graph.

See [`docs/winui-window.md`](docs/winui-window.md) for the standalone guide.
