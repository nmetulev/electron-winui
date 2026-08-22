const assert = require('node:assert/strict');
const { test } = require('node:test');
const { activateMenuItem } = require('../src/menu-role');

function createWindow() {
  const calls = [];
  return {
    calls,
    close() {
      calls.push('close');
    },
    reload() {
      calls.push('reload');
    },
    webContents: {
      toggleDevTools() {
        calls.push('toggleDevTools');
      },
    },
  };
}

for (const [role, expectedCall] of [
  ['close', 'close'],
  ['reload', 'reload'],
  ['toggleDevTools', 'toggleDevTools'],
  ['toggledevtools', 'toggleDevTools'],
]) {
  test(`dispatches the ${role} menu role`, () => {
    const window = createWindow();
    const item = {
      role,
      click() {
        throw new Error('Electron role wrapper should not run');
      },
    };

    activateMenuItem(item, window);
    assert.deepEqual(window.calls, [expectedCall]);
  });
}

test('delegates unsupported roles to their Electron click wrapper', () => {
  const window = createWindow();
  const item = {
    role: 'quit',
    click(menuItem, browserWindow, webContents) {
      assert.equal(menuItem, item);
      assert.equal(browserWindow, window);
      assert.equal(webContents, window.webContents);
      window.calls.push('click');
    },
  };

  activateMenuItem(item, window);
  assert.deepEqual(window.calls, ['click']);
});

test('preserves click callbacks for non-role menu items', () => {
  const window = createWindow();
  const item = {
    click(menuItem, browserWindow, event) {
      assert.equal(menuItem, item);
      assert.equal(browserWindow, window);
      assert.deepEqual(event, {});
      window.calls.push('click');
    },
  };

  activateMenuItem(item, window);
  assert.deepEqual(window.calls, ['click']);
});
