const assert = require('node:assert/strict');
const path = require('node:path');
const {
  app,
  BaseWindow,
  Menu,
  WinUIWindow,
} = require('../dist');
const {
  FORWARDED_WEB_CONTENTS_EVENTS,
  SUPPORTED_BROWSER_WINDOW_METHODS,
  SUPPORTED_BROWSER_WINDOW_PROPERTIES,
  SUPPORTED_BROWSER_WINDOW_STATIC_METHODS,
} = require('../dist/window-api');

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
  for (const property of SUPPORTED_BROWSER_WINDOW_PROPERTIES) {
    assert.notEqual(window[property], undefined, `${property} is missing`);
  }
  for (const method of SUPPORTED_BROWSER_WINDOW_METHODS) {
    assert.equal(typeof window[method], 'function', `${method} is missing`);
  }
  for (const method of SUPPORTED_BROWSER_WINDOW_STATIC_METHODS) {
    assert.equal(
      typeof WinUIWindow[method],
      'function',
      `WinUIWindow.${method} is missing`
    );
  }
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

  for (const eventName of FORWARDED_WEB_CONTENTS_EVENTS) {
    const forwarded = new Promise((resolve) => {
      window.once(eventName, (...args) => resolve(args));
    });
    const marker = { eventName };
    window.webContents.emit(eventName, marker);
    assert.deepEqual(await forwarded, [marker]);
  }
  const pageTitleUpdated = new Promise((resolve) => {
    window.once('page-title-updated', (...args) => resolve(args));
  });
  const titleEvent = { defaultPrevented: true };
  window.webContents.emit(
    'page-title-updated',
    titleEvent,
    'Conformance title',
    true
  );
  assert.deepEqual(await pageTitleUpdated, [
    titleEvent,
    'Conformance title',
    true,
  ]);

  const ready = new Promise((resolve) => {
    window.once('ready-to-show', resolve);
  });
  await window.loadFile(path.join(__dirname, 'fixture.html'));
  await ready;
  assert.equal(window.webContents.isDestroyed(), false);
  assert.match(window.webContents.getURL(), /fixture\.html$/);
  window.setMenuBarVisibility(false);
  assert.equal(window.isMenuBarVisible(), false);
  window.setMenu(
    Menu.buildFromTemplate([
      {
        label: 'Replacement',
        submenu: [{ label: 'Reload', role: 'reload' }],
      },
    ])
  );
  assert.equal(window.isMenuBarVisible(), false);
  window.setMenuBarVisibility(true);
  assert.equal(window.isMenuBarVisible(), true);
  window.removeMenu();
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
