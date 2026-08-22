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

Set Electron's theme source and send the effective result to the renderer for
CSS styling. The native shell observes `nativeTheme` and updates automatically:

```js
nativeTheme.themeSource = source;
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

The package returns a genuine Electron `BaseWindow` augmented with a deliberate
`BrowserWindow`-like subset:

- property: `webContents`
- methods: `loadFile`, `loadURL`, `reload`, `capturePage`, `setMenu`,
  `removeMenu`, `setMenuBarVisibility`, and `isMenuBarVisible`
- static lookups: `getAllWindows`, `fromId`, `fromWebContents`, and
  `getFocusedWindow`
- forwarded events: `enter-html-full-screen`, `leave-html-full-screen`,
  `responsive`, `unresponsive`, `page-title-updated`, and `ready-to-show`

Common `BaseWindow` lifecycle and geometry APIs remain inherited, including
window bounds, show/hide, minimize/maximize, and parent-window behavior.

## Package production builds

The packaged executable also needs the PerMonitorV2 manifest. Patch it after
Electron packaging but before signing:

```js
const {
  prepareElectronExecutable,
} = require('electron-winui');

await prepareElectronExecutable('out/MyApp-win32-x64/MyApp.exe');
```

Use `checkElectronExecutable(path)` or `electron-winui prepare --check <path>`
to report compliance without changing the file. `prepare --dry-run` reports the
planned backup and signing state.

Preparation uses WinAppCLI `mt.exe` against a same-directory temporary copy,
verifies PerMonitorV2 semantically, and verifies that all other manifest
elements and attributes match before an atomic replacement. The original is
retained as `<executable>.electron-winui.backup`; replacement failures restore
it. File mode and timestamps are preserved where practical.

Electron's `disableWindowFiltering`, legacy `dpiAware`, `asInvoker` trust
settings, Common Controls v6 dependency, and OS compatibility declarations are
preserved. Unknown future Electron manifest revisions fail closed because
WinAppCLI does not yet expose a semantic manifest merge primitive.

Then sign or place the executable in an MSIX package. Signed executables are
refused unless `allowSigned: true`/`--allow-signed` explicitly acknowledges
that the signature will be invalidated and the next build step will re-sign.

## Current compatibility

Supported:

- explicit `WinUIWindow` creation
- `webContents`, `loadFile`, `loadURL`, `reload`, and `capturePage`
- common `BaseWindow` lifecycle and geometry methods
- `setMenu`, `removeMenu`, `setMenuBarVisibility`, and `isMenuBarVisible`
- package `getAllWindows`, `fromId`, `fromWebContents`, and `getFocusedWindow`
- `enter-html-full-screen`, `leave-html-full-screen`, `responsive`,
  `unresponsive`, `page-title-updated`, and `ready-to-show` events
- simple application menus and asynchronous message boxes
- `close`, `reload`, and `toggleDevTools` menu roles
- renderer, preload, context isolation, sandbox, and IPC

Not yet guaranteed:

- `instanceof electron.BrowserWindow`
- third-party modules that import Electron's original `BrowserWindow` directly
- automatic shell conversion for renderer `window.open()`
- nested/check/radio menu parity, accelerators, and roles beyond `close`,
  `reload`, and `toggleDevTools`
- transparent/fullscreen windows and docked DevTools
- Electron versions other than 43

For the complete preview API and runnable example, see the
[repository README](../README.md) and [`example/`](../example/).
