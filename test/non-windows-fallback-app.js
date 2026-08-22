const assert = require('node:assert/strict');
const electron = require('electron');

if (process.platform === 'win32') {
  throw new Error('The non-Windows fallback fixture must run on macOS or Linux.');
}

const packageRoot = process.env.ELECTRON_WINUI_PACKAGE_ROOT;
assert.ok(packageRoot, 'ELECTRON_WINUI_PACKAGE_ROOT must target the installed package.');
const electronWinUI = require(packageRoot);

assert.equal(electronWinUI.WinUIWindow, electron.BrowserWindow);
assert.equal(electronWinUI.Menu, electron.Menu);
assert.equal(electronWinUI.dialog, electron.dialog);

electronWinUI.prepareElectronExecutable('relative/electron').then((result) => {
  assert.equal(result, 'relative/electron');
  console.log(`NON_WINDOWS_FALLBACK_READY:${process.platform}`);
  electron.app.quit();
}).catch((error) => {
  console.error(error);
  electron.app.exit(1);
});
