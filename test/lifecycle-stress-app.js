const assert = require('node:assert/strict');
const path = require('node:path');
const { app, WinUIWindow } = require('../dist');

const iterations = 12;

async function createAndCloseWindow(index) {
  const window = new WinUIWindow({
    show: false,
    title: `Lifecycle stress ${index}`,
  });
  const ready = new Promise((resolve) => window.once('ready-to-show', resolve));
  await Promise.all([
    window.loadFile(path.join(__dirname, 'fixture.html')),
    ready,
  ]);
  assert.equal(window.isDestroyed(), false);

  const closed = new Promise((resolve) => window.once('closed', resolve));
  window.close();
  await closed;
  assert.deepEqual(WinUIWindow.getAllWindows(), []);
}

app.whenReady().then(async () => {
  for (let index = 0; index < iterations; index += 1) {
    await createAndCloseWindow(index);
  }
  console.log(`LIFECYCLE_STRESS_READY:${iterations}`);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
