<!-- mslearn: true -->
<!-- description: Replace Electron BrowserWindow chrome with a native WinUI 3 shell while keeping the existing Chromium renderer, preload, and IPC. -->
# Use a native WinUI shell with Electron (preview)

`electron-winui` is an experimental companion package that places
an unchanged Electron renderer inside an Electron `BaseWindow` with a native
Windows titlebar and WinUI 3 menu bar, flyouts, and dialogs.

> [!WARNING]
> The package currently targets Electron 43 and a documented subset of
> `BrowserWindow`. Evaluate the compatibility matrix before adopting it.

## Install and prepare

```powershell
npm install electron@43 electron-winui
npx electron-winui prepare
```

The preparation command changes Electron's development executable manifest
from Per-Monitor V1 to Per-Monitor V2 DPI awareness. WinUI cannot initialize
inside Electron without this setting.

## Change the main-process import

```diff
+ const { app, WinUIWindow, Menu, dialog } =
+   require('electron-winui');
```

Continue importing renderer-safe APIs from Electron in preload code:

```js
const { contextBridge, ipcRenderer } = require('electron');
```

Existing renderer HTML, IPC channels, and `webContents` calls remain in place:

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

Update the native titlebar identity without recreating the window:

```js
window.setSubtitle('PROJECT ALPHA');
window.setTitleBarIcon('assets/project.svg');
```

Optionally place a native search box in the titlebar:

```js
window.setTitleBarSearch({
  placeholder: 'Search this project',
  width: 320,
});

window.on('titlebar-search-changed', (text) => updateResults(text));
window.on('titlebar-search-submitted', (query) => runSearch(query));
```

Call `window.setTitleBarSearch(null)` to remove it.

Electron application menus created through the package are projected into a
WinUI `MenuBar`. Asynchronous `dialog.showMessageBox(window, options)` calls
use a WinUI `ContentDialog`.

Use the same theme source for the native shell and Electron, then send the
effective result to the renderer for CSS styling:

```js
nativeTheme.themeSource = source;
window.setTheme(source);
window.webContents.send('theme-changed', {
  source,
  shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
});
```

Package menus can also open as native WinUI context menus over Chromium:

```js
const menu = Menu.buildFromTemplate([
  { label: 'Refresh', role: 'reload' },
  { type: 'separator' },
  { label: 'Close', role: 'close' },
]);

window.webContents.on('context-menu', (_event, params) => {
  menu.popup({ window, x: params.x, y: params.y });
});
```

The preview context-menu projection supports visible flat items and
separators. Electron's normal popup implementation remains the fallback for
non-`WinUIWindow` targets.

## Architecture

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
} = require('electron-winui');

await prepareElectronExecutable('out/MyApp-win32-x64/MyApp.exe');
```

Then sign or place the executable in an MSIX package. Patching a signed
executable invalidates its signature.

## Current compatibility

Supported:

- explicit `WinUIWindow` creation
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
- Electron versions other than 43

For the complete preview API and runnable example, see the
[repository README](../README.md) and [`example/`](../example/).
