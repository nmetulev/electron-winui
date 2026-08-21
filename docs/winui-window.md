<!-- mslearn: true -->
<!-- description: Replace Electron BrowserWindow chrome with a native WinUI 3 shell while keeping the existing Chromium renderer, preload, and IPC. -->
# Use a native WinUI shell with Electron (preview)

`@microsoft/electron-winui` is an experimental companion package that places
an unchanged Electron renderer inside an Electron `BaseWindow` with a native
WinUI 3 title area, menu bar, flyouts, and dialogs.

> [!WARNING]
> The package currently targets Electron 39 and a documented subset of
> `BrowserWindow`. Evaluate the compatibility matrix before adopting it.

## Install and prepare

```powershell
npm install electron@39 @microsoft/electron-winui
npx electron-winui prepare
```

The preparation command changes Electron's development executable manifest
from Per-Monitor V1 to Per-Monitor V2 DPI awareness. WinUI cannot initialize
inside Electron without this setting.

## Change the main-process import

```diff
- const { app, BrowserWindow, Menu, dialog } = require('electron');
+ const { app, BrowserWindow, Menu, dialog } =
+   require('@microsoft/electron-winui');
```

Continue importing renderer-safe APIs from Electron in preload code:

```js
const { contextBridge, ipcRenderer } = require('electron');
```

Existing renderer HTML, IPC channels, and `webContents` calls remain in place:

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

Electron application menus created through the package are projected into a
WinUI `MenuBar`. Asynchronous `dialog.showMessageBox(window, options)` calls
use a WinUI `ContentDialog`.

## Architecture

```text
Electron BaseWindow
├─ WinUI DesktopWindowXamlSource
│  ├─ native title content
│  ├─ MenuBar and flyouts
│  └─ ContentDialog
└─ WebContentsView
   └─ unchanged Chromium renderer
```

The package returns a genuine Electron `BaseWindow` augmented with common
`BrowserWindow` members. This keeps native APIs that accept `BaseWindow`
working while preserving `webContents`, `loadFile`, `loadURL`, window bounds,
show/hide, minimize/maximize, and parent-window behavior.

## Package production builds

The packaged executable also needs the PerMonitorV2 manifest. Patch it after
Electron packaging but before signing:

```js
const {
  prepareElectronExecutable,
} = require('@microsoft/electron-winui');

await prepareElectronExecutable('out/MyApp-win32-x64/MyApp.exe');
```

Then sign or place the executable in an MSIX package. Patching a signed
executable invalidates its signature.

## Current compatibility

Supported:

- explicit `WinUIWindow`/package `BrowserWindow` creation
- `webContents`, `loadFile`, `loadURL`, `reload`, and `capturePage`
- common `BaseWindow` lifecycle and geometry methods
- package `getAllWindows`, `fromId`, `fromWebContents`, and `getFocusedWindow`
- simple application menus and asynchronous message boxes
- renderer, preload, context isolation, sandbox, and IPC

Not yet guaranteed:

- `instanceof electron.BrowserWindow`
- third-party modules that import Electron's original `BrowserWindow` directly
- automatic shell conversion for renderer `window.open()`
- every menu type, role, and accelerator
- transparent/fullscreen windows and docked DevTools
- Electron versions other than 39

For the complete preview API and runnable example, see the
[repository README](../README.md) and [`example/`](../example/).
