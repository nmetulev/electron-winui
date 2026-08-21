const assert = require('node:assert/strict');
const path = require('node:path');
const {
  app,
  BrowserWindow,
} = require('../dist');

app.whenReady().then(async () => {
  const first = new BrowserWindow({ show: false, title: 'First WinUIWindow' });
  const second = new BrowserWindow({ show: false, title: 'Second WinUIWindow' });

  assert.equal(BrowserWindow.getAllWindows().length, 2);
  assert.equal(BrowserWindow.fromId(first.id), first);
  assert.equal(BrowserWindow.fromWebContents(second.webContents), second);

  const firstReady = new Promise((resolve) => first.once('ready-to-show', resolve));
  const secondReady = new Promise((resolve) =>
    second.once('ready-to-show', resolve)
  );
  await Promise.all([
    first.loadFile(path.join(__dirname, 'fixture.html')),
    second.loadFile(path.join(__dirname, 'fixture.html')),
    firstReady,
    secondReady,
  ]);

  const firstClosed = new Promise((resolve) => first.once('closed', resolve));
  first.close();
  await firstClosed;

  assert.equal(second.isDestroyed(), false);
  assert.deepEqual(BrowserWindow.getAllWindows(), [second]);
  second.setTitle('Second window survived');

  console.log('MULTI_WINDOW_READY');
  setTimeout(() => second.close(), 300);
});

app.on('window-all-closed', () => app.quit());
