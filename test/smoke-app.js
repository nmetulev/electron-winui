const assert = require('node:assert/strict');
const path = require('node:path');
const {
  app,
  BaseWindow,
  Menu,
  WinUIWindow,
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

  window = new WinUIWindow({
    show: false,
    title: 'WinUIWindow smoke test',
    winui: {
      icon: path.join(__dirname, '..', 'example', 'electron-winui.svg'),
      searchBox: {
        placeholder: 'Search smoke test',
        width: 300,
      },
      subtitle: 'COMPATIBILITY SMOKE TEST',
    },
  });

  assert.equal(window instanceof BaseWindow, true);
  assert.equal(window instanceof WinUIWindow, true);
  assert.equal(WinUIWindow.fromId(window.id), window);
  assert.equal(WinUIWindow.fromWebContents(window.webContents), window);
  assert.deepEqual(WinUIWindow.getAllWindows(), [window]);
  assert.equal(window.webContents.getOwnerBrowserWindow(), window);
  assert.equal(
    window.webContents.getOwnerBrowserWindow().webContents,
    window.webContents
  );
  assert.equal(window.getSubtitle(), 'COMPATIBILITY SMOKE TEST');
  assert.match(window.getTitleBarIcon(), /electron-winui\.svg$/);
  window.setSubtitle('UPDATED SMOKE TEST');
  window.setTitleBarIcon(null);
  assert.equal(window.getSubtitle(), 'UPDATED SMOKE TEST');
  assert.equal(window.getTitleBarIcon(), null);
  assert.deepEqual(window.getTitleBarSearch(), {
    placeholder: 'Search smoke test',
    text: '',
    width: 300,
  });
  window.setTitleBarSearch({ placeholder: 'Updated search', text: 'query' });
  assert.deepEqual(window.getTitleBarSearch(), {
    placeholder: 'Updated search',
    text: 'query',
    width: 280,
  });
  window.setTitleBarSearch(null);
  assert.equal(window.getTitleBarSearch(), null);

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
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  app.quit();
});
