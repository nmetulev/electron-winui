const electron = require('electron');

let applicationMenu;
const listeners = new Set();
const popupHandlers = new WeakMap();
const electronPopup = electron.Menu.prototype.popup;

function decorateMenu(menu) {
  Object.defineProperty(menu, 'popup', {
    configurable: true,
    value(options = {}) {
      const handler = options.window && popupHandlers.get(options.window);
      if (handler) {
        return handler(menu, options);
      }
      return electronPopup.call(menu, options);
    },
  });
  return menu;
}

function WinUIMenu(...args) {
  return decorateMenu(Reflect.construct(electron.Menu, args));
}

Object.setPrototypeOf(WinUIMenu, electron.Menu);
WinUIMenu.prototype = electron.Menu.prototype;

WinUIMenu.buildFromTemplate = (template) =>
  decorateMenu(electron.Menu.buildFromTemplate(template));

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

function registerMenuPopup(window, handler) {
  popupHandlers.set(window, handler);
  return () => popupHandlers.delete(window);
}

module.exports = {
  Menu: WinUIMenu,
  getApplicationMenu: () => applicationMenu,
  onApplicationMenuChanged,
  registerMenuPopup,
};
