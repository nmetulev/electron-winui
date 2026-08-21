const assert = require('node:assert/strict');
const path = require('node:path');
const {
  app,
  BaseWindow,
  BrowserWindow,
  Menu,
} = require('../dist');

let window;

app.whenReady().then(async () => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [{ label: 'Close', role: 'close' }],
      },
      {
        label: 'View',
        submenu: [{ label: 'Reload', role: 'reload' }],
      },
    ])
  );

  window = new BrowserWindow({
    show: false,
    title: 'WinUIWindow smoke test',
    winui: {
      subtitle: 'COMPATIBILITY SMOKE TEST',
    },
  });

  assert.equal(window instanceof BaseWindow, true);
  assert.equal(window instanceof BrowserWindow, true);
  assert.equal(BrowserWindow.fromId(window.id), window);
  assert.equal(BrowserWindow.fromWebContents(window.webContents), window);
  assert.deepEqual(BrowserWindow.getAllWindows(), [window]);
  assert.equal(window.webContents.getOwnerBrowserWindow(), window);
  assert.equal(
    window.webContents.getOwnerBrowserWindow().webContents,
    window.webContents
  );

  const ready = new Promise((resolve) => {
    window.once('ready-to-show', resolve);
  });
  await window.loadFile(path.join(__dirname, 'fixture.html'));
  await ready;
  assert.equal(window.webContents.isDestroyed(), false);
  assert.match(window.webContents.getURL(), /fixture\.html$/);
  window.setMenuBarVisibility(false);
  assert.equal(window.isMenuBarVisible(), false);
  window.setMenuBarVisibility(true);
  assert.equal(window.isMenuBarVisible(), true);
  window.setMenu(null);
  assert.equal(window.isMenuBarVisible(), false);
  window.setMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [{ label: 'Close', role: 'close' }],
      },
    ])
  );
  assert.equal(window.isMenuBarVisible(), true);

  window.show();
  console.log(`WINUI_WINDOW_READY:${window.id}`);
  setTimeout(() => window.close(), 500);
});

app.on('window-all-closed', () => {
  app.quit();
});
