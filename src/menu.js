const electron = require('electron');

let applicationMenu;
const listeners = new Set();

function WinUIMenu(...args) {
  return Reflect.construct(electron.Menu, args);
}

Object.setPrototypeOf(WinUIMenu, electron.Menu);
WinUIMenu.prototype = electron.Menu.prototype;

WinUIMenu.setApplicationMenu = (menu) => {
  applicationMenu = menu;
  electron.Menu.setApplicationMenu(null);
  for (const listener of listeners) {
    listener(menu);
  }
};

WinUIMenu.getApplicationMenu = () => applicationMenu ?? null;

function onApplicationMenuChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

module.exports = {
  Menu: WinUIMenu,
  getApplicationMenu: () => applicationMenu,
  onApplicationMenuChanged,
};
