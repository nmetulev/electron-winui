const assert = require('node:assert/strict');
const { app, BaseWindow, WinUIWindow } = require('electron-winui');

let window;

app.whenReady().then(async () => {
  window = new WinUIWindow({
    show: false,
    title: 'Packed consumer smoke test',
  });
  assert.equal(window instanceof BaseWindow, true);
  assert.equal(window instanceof WinUIWindow, true);

  const ready = new Promise((resolve) => window.once('ready-to-show', resolve));
  await Promise.all([
    window.loadURL('data:text/html,<title>Packed consumer</title>'),
    ready,
  ]);
  assert.equal(window.webContents.isDestroyed(), false);
  console.log('PACKED_ELECTRON_READY');
  window.close();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
