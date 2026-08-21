const electron = require('electron');
const { dialog } = require('./dialog');
const { Menu } = require('./menu');
const { prepareElectronExecutable } = require('./prepare');

const overrides =
  process.platform === 'win32'
    ? require('./window')
    : {
        WinUIWindow: electron.BrowserWindow,
      };

const api = {};
for (const [name, descriptor] of Object.entries(
  Object.getOwnPropertyDescriptors(electron)
)) {
  if (!['Menu', 'dialog'].includes(name)) {
    Object.defineProperty(api, name, descriptor);
  }
}

Object.defineProperties(api, {
  WinUIWindow: {
    enumerable: true,
    value: overrides.WinUIWindow,
  },
  Menu: {
    enumerable: true,
    value: process.platform === 'win32' ? Menu : electron.Menu,
  },
  dialog: {
    enumerable: true,
    value: process.platform === 'win32' ? dialog : electron.dialog,
  },
  prepareElectronExecutable: {
    enumerable: true,
    value: prepareElectronExecutable,
  },
});

module.exports = api;
