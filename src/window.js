const electron = require('electron');
const { showContentDialog } = require('./content-dialog');
const { getRuntime } = require('./runtime');
const {
  getApplicationMenu,
  onApplicationMenuChanged,
} = require('./menu');

const stateByWindow = new WeakMap();
const windows = new Set();

const defaultShellHeight = 96;
const defaultTitleBarHeight = 48;
const captionButtonWidth = 144;

const thickness = (left, top, right, bottom) => ({
  left,
  top,
  right,
  bottom,
});

function createText(bindings, text, size, weight = 400) {
  const block = new bindings.TextBlock();
  block.text = text;
  block.fontSize = size;
  block.fontWeight = { weight };
  block.verticalAlignment = bindings.VerticalAlignment.Center;
  return block;
}

function appendChildren(bindings, panel, ...children) {
  const collection = panel.children.as(bindings.IVector_UIElement);
  for (const child of children) {
    collection.append(child);
  }
}

function createBrush(bindings, a, r, g, b) {
  return new bindings.SolidColorBrush({ a, r, g, b });
}

function addMenuItem(bindings, target, item, window, subscriptions) {
  if (!item.visible || item.type === 'separator') {
    return;
  }

  const menuItem = new bindings.MenuFlyoutItem();
  menuItem.text = item.label || item.role || '';
  menuItem.isEnabled = item.enabled;
  if (item.accelerator) {
    menuItem.keyboardAcceleratorTextOverride = item.accelerator;
  }

  subscriptions.push(
    menuItem.onClick(() => {
      if (item.role && typeof item.click === 'function') {
        item.click(item, window, window.webContents);
      } else if (typeof item.click === 'function') {
        item.click(item, window, {});
      }
    })
  );
  target.items.append(menuItem);
}

function defaultMenu() {
  return electron.Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [{ label: 'Close', role: 'close' }],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', role: 'reload' },
        { label: 'Toggle Developer Tools', role: 'toggleDevTools' },
      ],
    },
  ]);
}

function rebuildMenu(window) {
  const state = stateByWindow.get(window);
  if (!state) {
    return;
  }

  for (const unsubscribe of state.menuSubscriptions.splice(0)) {
    unsubscribe();
  }
  state.menuBar.items.clear();

  const configuredMenu =
    state.windowMenu !== undefined
      ? state.windowMenu
      : getApplicationMenu();
  if (configuredMenu === null) {
    state.menuVisible = false;
    state.menuBar.visibility = state.bindings.Visibility.Collapsed;
    layoutView(window);
    syncShellBounds(window);
    return;
  }

  const menu = configuredMenu ?? defaultMenu();
  state.menuVisible = true;
  state.menuBar.visibility = state.bindings.Visibility.Visible;
  for (const item of menu.items) {
    if (!item.visible || !item.submenu) {
      continue;
    }

    const topLevel = new state.bindings.MenuBarItem();
    topLevel.title = item.label || item.role || '';
    for (const child of item.submenu.items) {
      addMenuItem(
        state.bindings,
        topLevel,
        child,
        window,
        state.menuSubscriptions
      );
    }
    state.menuBar.items.append(topLevel);
  }
}

function shellHeight(state) {
  return state.menuVisible ? state.shellHeight : state.titleBarHeight;
}

function layoutView(window) {
  const state = stateByWindow.get(window);
  if (!state || window.isDestroyed()) {
    return;
  }

  const [width, height] = window.getContentSize();
  const top = shellHeight(state);
  state.view.setBounds({
    x: 0,
    y: top,
    width,
    height: Math.max(1, height - top),
  });
}

function syncShellBounds(window) {
  const state = stateByWindow.get(window);
  if (!state || window.isDestroyed()) {
    return;
  }

  const scale = electron.screen.getDisplayMatching(window.getBounds()).scaleFactor;
  const client = state.appWindow.clientSize;
  const width = state.dialogOpen
    ? client.width
    : Math.max(1, client.width - Math.round(captionButtonWidth * scale));
  const height = state.dialogOpen
    ? client.height
    : Math.max(1, Math.round(shellHeight(state) * scale));

  state.source.siteBridge.moveAndResize({ x: 0, y: 0, width, height });
  state.source.siteBridge.moveInZOrderAtTop();

  if (!state.dialogOpen) {
    state.appWindow.titleBar.extendsContentIntoTitleBar = true;
    state.appWindow.titleBar.setDragRectangles([
      {
        x: 0,
        y: 0,
        width,
        height: Math.round(state.titleBarHeight * scale),
      },
    ]);
  }
}

function setTheme(window, dark) {
  const state = stateByWindow.get(window);
  if (!state) {
    return;
  }

  state.root.requestedTheme = dark
    ? state.bindings.ElementTheme.Dark
    : state.bindings.ElementTheme.Light;
  state.shellSurface.background = dark
    ? createBrush(state.bindings, 255, 32, 32, 32)
    : createBrush(state.bindings, 255, 243, 243, 243);
  state.appWindow.titleBar.preferredTheme = dark
    ? state.bindings.TitleBarTheme.Dark
    : state.bindings.TitleBarTheme.Light;
  window.setTitleBarOverlay({
    color: dark ? '#202020' : '#f3f3f3',
    symbolColor: dark ? '#ffffff' : '#1f1f1f',
    height: state.titleBarHeight,
  });
}

function createShell(window, options, view) {
  const { bindings } = getRuntime();
  const hwnd = window.getNativeWindowHandle().readBigUInt64LE(0);
  const appWindow = bindings.AppWindow.getFromWindowId({ value: hwnd });
  const source = new bindings.DesktopWindowXamlSource();
  source.initialize({ value: hwnd });
  source.shouldConstrainPopupsToWorkArea = true;

  const root = new bindings.Grid();
  root.background = createBrush(bindings, 0, 0, 0, 0);

  const shellHeightValue = options.winui?.shellHeight ?? defaultShellHeight;
  const titleBarHeight = defaultTitleBarHeight;
  const shellSurface = new bindings.Border();
  shellSurface.height = shellHeightValue;
  shellSurface.verticalAlignment = bindings.VerticalAlignment.Top;

  const shell = new bindings.StackPanel();
  shell.orientation = bindings.Orientation.Vertical;

  const titleRow = new bindings.Grid();
  titleRow.height = titleBarHeight;

  const titleText = createText(
    bindings,
    options.title ?? electron.app.name,
    14,
    600
  );
  titleText.margin = thickness(16, 0, 16, 0);
  titleText.horizontalAlignment = bindings.HorizontalAlignment.Left;

  const subtitle = createText(
    bindings,
    options.winui?.subtitle ?? 'ELECTRON + WINUI 3',
    11,
    600
  );
  subtitle.margin = thickness(210, 0, 12, 0);
  subtitle.horizontalAlignment = bindings.HorizontalAlignment.Left;
  subtitle.opacity = 0.62;
  appendChildren(bindings, titleRow, titleText, subtitle);

  const menuBar = new bindings.MenuBar();
  menuBar.height = shellHeightValue - titleBarHeight;
  menuBar.horizontalAlignment = bindings.HorizontalAlignment.Stretch;

  appendChildren(bindings, shell, titleRow, menuBar);
  shellSurface.child = shell;
  appendChildren(bindings, root, shellSurface);
  source.content = root;

  const state = {
    appWindow,
    bindings,
    dialogOpen: false,
    menuBar,
    menuSubscriptions: [],
    menuVisible: true,
    root,
    shellHeight: shellHeightValue,
    shellReady: false,
    shellSurface,
    source,
    subscriptions: [],
    titleBarHeight,
    titleText,
    view,
    windowMenu: undefined,
  };
  stateByWindow.set(window, state);

  const dark = electron.nativeTheme.shouldUseDarkColors;
  setTheme(window, dark);
  rebuildMenu(window);

  state.subscriptions.push(
    root.onceLoaded(() => {
      state.shellReady = true;
      layoutView(window);
      syncShellBounds(window);
      if (options.show !== false) {
        window.show();
        setImmediate(() => layoutView(window));
      }
    })
  );

  return state;
}

function forwardWebContentsEvents(window, state) {
  const events = [
    'enter-html-full-screen',
    'leave-html-full-screen',
    'responsive',
    'unresponsive',
  ];
  for (const eventName of events) {
    const handler = (...args) => window.emit(eventName, ...args);
    state.view.webContents.on(eventName, handler);
    state.subscriptions.push(() =>
      state.view.webContents.removeListener(eventName, handler)
    );
  }

  const titleHandler = (event, title, explicitSet) => {
    window.emit('page-title-updated', event, title, explicitSet);
    if (!event.defaultPrevented) {
      window.setTitle(title);
      state.titleText.text = title;
    }
  };
  state.view.webContents.on('page-title-updated', titleHandler);
  state.subscriptions.push(() =>
    state.view.webContents.removeListener('page-title-updated', titleHandler)
  );

  state.view.webContents.once('did-finish-load', () => {
    window.emit('ready-to-show');
  });
}

function cleanupWindow(window) {
  const state = stateByWindow.get(window);
  if (!state) {
    return;
  }

  windows.delete(window);
  for (const unsubscribe of [
    ...state.menuSubscriptions,
    ...state.subscriptions,
  ]) {
    unsubscribe();
  }
  state.source.close();
  if (!state.view.webContents.isDestroyed()) {
    state.view.webContents.close();
  }
  stateByWindow.delete(window);
}

function WinUIWindow(options = {}) {
  if (!new.target) {
    throw new TypeError('WinUIWindow must be constructed with new.');
  }

  const {
    paintWhenInitiallyHidden: _paintWhenInitiallyHidden,
    show: _show,
    webPreferences,
    winui: _winui,
    ...windowOptions
  } = options;

  const window = new electron.BaseWindow({
    ...windowOptions,
    frame: true,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f3f3f3',
      symbolColor: '#1f1f1f',
      height: defaultTitleBarHeight,
    },
  });
  Object.setPrototypeOf(window, WinUIWindow.prototype);

  const view = new electron.WebContentsView(
    webPreferences ? { webPreferences } : {}
  );
  window.contentView.addChildView(view);
  const state = createShell(window, options, view);

  windows.add(window);
  layoutView(window);
  forwardWebContentsEvents(window, state);

  const resizeHandler = () => {
    layoutView(window);
    syncShellBounds(window);
  };
  window.on('resize', resizeHandler);
  state.subscriptions.push(() => window.removeListener('resize', resizeHandler));

  const themeHandler = () =>
    setTheme(window, electron.nativeTheme.shouldUseDarkColors);
  electron.nativeTheme.on('updated', themeHandler);
  state.subscriptions.push(() =>
    electron.nativeTheme.removeListener('updated', themeHandler)
  );

  const removeMenuListener = onApplicationMenuChanged(() => rebuildMenu(window));
  state.subscriptions.push(removeMenuListener);
  window.once('closed', () => cleanupWindow(window));

  electron.app.emit('browser-window-created', {}, window);
  return window;
}

WinUIWindow.prototype = Object.create(electron.BaseWindow.prototype, {
  constructor: {
    configurable: true,
    value: WinUIWindow,
    writable: true,
  },
  webContents: {
    configurable: true,
    get() {
      return stateByWindow.get(this)?.view.webContents;
    },
  },
});

Object.setPrototypeOf(WinUIWindow, electron.BaseWindow);

WinUIWindow.prototype.loadFile = function loadFile(filePath, options) {
  return this.webContents.loadFile(filePath, options);
};

WinUIWindow.prototype.loadURL = function loadURL(url, options) {
  return this.webContents.loadURL(url, options);
};

WinUIWindow.prototype.reload = function reload() {
  this.webContents.reload();
};

WinUIWindow.prototype.capturePage = function capturePage(rect) {
  return this.webContents.capturePage(rect);
};

WinUIWindow.prototype.setMenu = function setMenu(menu) {
  const state = stateByWindow.get(this);
  if (!state) {
    return;
  }
  state.windowMenu = menu;
  rebuildMenu(this);
};

WinUIWindow.prototype.removeMenu = function removeMenu() {
  this.setMenu(null);
};

WinUIWindow.prototype.setMenuBarVisibility = function setMenuBarVisibility(
  visible
) {
  const state = stateByWindow.get(this);
  if (!state) {
    return;
  }
  state.menuVisible = visible;
  state.menuBar.visibility = visible
    ? state.bindings.Visibility.Visible
    : state.bindings.Visibility.Collapsed;
  layoutView(this);
  syncShellBounds(this);
};

WinUIWindow.prototype.isMenuBarVisible = function isMenuBarVisible() {
  return stateByWindow.get(this)?.menuVisible ?? false;
};

WinUIWindow.getAllWindows = () =>
  [...windows].filter((window) => !window.isDestroyed());

WinUIWindow.fromId = (id) =>
  WinUIWindow.getAllWindows().find((window) => window.id === id) ?? null;

WinUIWindow.fromWebContents = (webContents) =>
  WinUIWindow.getAllWindows().find(
    (window) => window.webContents === webContents
  ) ?? null;

WinUIWindow.getFocusedWindow = () =>
  WinUIWindow.getAllWindows().find((window) => window.isFocused()) ?? null;

function isWinUIWindow(window) {
  return stateByWindow.has(window);
}

async function showMessageBox(window, options) {
  const state = stateByWindow.get(window);
  if (!state) {
    return electron.dialog.showMessageBox(window, options);
  }
  return showContentDialog(state, options, () => syncShellBounds(window));
}

module.exports = {
  WinUIWindow,
  isWinUIWindow,
  showMessageBox,
};
