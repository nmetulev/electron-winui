const electron = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { showContentDialog } = require('./content-dialog');
const { getRuntime } = require('./runtime');
const { activateMenuItem } = require('./menu-role');
const {
  getApplicationMenu,
  onApplicationMenuChanged,
  registerMenuPopup,
} = require('./menu');
const { FORWARDED_WEB_CONTENTS_EVENTS } = require('./window-api');

const stateByWindow = new WeakMap();
const windows = new Set();

const defaultTitleBarHeight = 32;
const overlayTitleBarHeight = 32;
const defaultMenuHeight = 40;
const titleInputHeight = 48;
const titleSearchMargin = 16;
const titleSearchMinWidth = 180;
const titleIdentityFallbackWidth = 360;

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

function iconUri(icon) {
  return /^[a-z][a-z\d+.-]*:/i.test(icon)
    ? icon
    : pathToFileURL(path.resolve(icon)).href;
}

function updateTitleBarIcon(state, icon) {
  state.titleBarIcon = icon ?? null;
  state.titleIcon.visibility = icon
    ? state.bindings.Visibility.Visible
    : state.bindings.Visibility.Collapsed;
  state.titleText.margin = thickness(icon ? 40 : 16, 0, 16, 0);
  if (!icon) {
    state.titleIcon.source = null;
    return;
  }
  const uri = iconUri(icon);
  const ImageSource = /\.svg(?:[?#]|$)/i.test(uri)
    ? state.bindings.SvgImageSource
    : state.bindings.BitmapImage;
  state.titleIcon.source = new ImageSource(new state.bindings.Uri(uri));
}

function updateTitleBarSearch(window, options) {
  const state = stateByWindow.get(window);
  if (!state) {
    return;
  }
  if (!options) {
    state.titleBarSearch = null;
    state.titleSearch.visibility = state.bindings.Visibility.Collapsed;
    syncShellBounds(window);
    return;
  }

  const placeholder = options.placeholder ?? 'Search';
  const width = options.width ?? 280;
  state.titleBarSearch = { placeholder, width };
  state.titleSearch.placeholderText = placeholder;
  state.titleSearch.width = width;
  if (Object.hasOwn(options, 'text')) {
    state.titleSearch.text = options.text ?? '';
  }
  state.titleSearch.visibility = state.bindings.Visibility.Visible;
  syncShellBounds(window);
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
      hideMenuOverlay(window);
      activateMenuItem(item, window);
    })
  );
  target.items.append(menuItem);
}

function hideMenuOverlay(window) {
  const state = stateByWindow.get(window);
  if (!state || window.isDestroyed()) {
    return;
  }
  state.contextSource.siteBridge.moveAndResize({
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });
}

function showMenuOverlay(window) {
  const state = stateByWindow.get(window);
  if (!state || window.isDestroyed()) {
    return;
  }
  const scale = electron.screen.getDisplayMatching(window.getBounds()).scaleFactor;
  const client = state.appWindow.clientSize;
  const top = Math.round(shellHeight(state) * scale);
  state.contextSource.siteBridge.moveAndResize({
    x: 0,
    y: top,
    width: client.width,
    height: Math.max(1, client.height - top),
  });
  state.contextSource.siteBridge.moveInZOrderAtTop();
}

function showContextMenu(window, menu, options) {
  const state = stateByWindow.get(window);
  if (!state || window.isDestroyed()) {
    return;
  }

  state.activeContextMenu?.hide();
  const flyout = new state.bindings.MenuFlyout();
  const subscriptions = [];
  for (const item of menu.items) {
    if (!item.visible) {
      continue;
    }
    if (item.type === 'separator') {
      flyout.items.append(new state.bindings.MenuFlyoutSeparator());
      continue;
    }
    addMenuItem(
      state.bindings,
      flyout,
      item,
      window,
      subscriptions
    );
  }

  state.activeContextMenu = flyout;
  showMenuOverlay(window);
  flyout.onceClosed(() => {
    for (const unsubscribe of subscriptions) {
      unsubscribe();
    }
    if (state.activeContextMenu === flyout) {
      state.activeContextMenu = null;
      hideMenuOverlay(window);
    }
    options.callback?.();
  });
  flyout.showAt(state.contextRoot, {
    x: options.x ?? 0,
    y: options.y ?? 0,
  });
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
    state.menuAvailable = false;
    state.menuVisible = false;
    state.menuBar.visibility = state.bindings.Visibility.Collapsed;
    layoutView(window);
    syncShellBounds(window);
    return;
  }

  const menu = configuredMenu ?? defaultMenu();
  if (!state.menuAvailable) {
    state.menuVisible = true;
  }
  state.menuAvailable = true;
  state.menuBar.visibility = state.menuVisible
    ? state.bindings.Visibility.Visible
    : state.bindings.Visibility.Collapsed;
  for (const item of menu.items) {
    if (!item.visible || !item.submenu) {
      continue;
    }

    const topLevel = new state.bindings.MenuBarItem();
    topLevel.title = item.label || item.role || '';
    state.menuSubscriptions.push(
      topLevel.onTapped(() => showMenuOverlay(window))
    );
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
  layoutView(window);
  syncShellBounds(window);
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
  const titleWidth = state.dialogOpen
    ? client.width
    : Math.max(1, client.width - state.appWindow.titleBar.rightInset);
  const titleHeight = state.dialogOpen
    ? client.height
    : Math.max(1, Math.round(titleInputHeight * scale));
  const titleVisualHeight = Math.max(
    1,
    Math.round(state.titleBarHeight * scale)
  );
  const menuHeight = state.menuVisible
    ? Math.max(1, Math.round(
        (state.shellHeight - state.titleBarHeight) * scale
      ))
    : 1;

  state.source.siteBridge.moveAndResize({
    x: 0,
    y: 0,
    width: titleWidth,
    height: titleHeight,
  });
  state.source.siteBridge.moveInZOrderAtTop();

  state.menuSource.siteBridge.moveAndResize({
    x: 0,
    y: titleVisualHeight,
    width: client.width,
    height: menuHeight,
  });
  if (state.dialogOpen) {
    return;
  }
  state.menuSource.siteBridge.moveInZOrderAtTop();
  if (!state.titleBarSearch) {
    state.appWindow.titleBar.setDragRectangles([
      { x: 0, y: 0, width: titleWidth, height: titleHeight },
    ]);
    return;
  }

  const identityWidth = Math.max(
    (state.titleBarIcon ? 40 : 16) + state.titleText.actualWidth,
    210 + state.subtitle.actualWidth,
    titleIdentityFallbackWidth
  );
  const availableWidth = titleWidth / scale - identityWidth - titleSearchMargin;
  const searchWidthDip = Math.min(state.titleBarSearch.width, availableWidth);
  if (searchWidthDip < titleSearchMinWidth) {
    state.titleSearch.visibility = state.bindings.Visibility.Collapsed;
    state.appWindow.titleBar.setDragRectangles([
      { x: 0, y: 0, width: titleWidth, height: titleHeight },
    ]);
    return;
  }

  state.titleSearch.width = searchWidthDip;
  state.titleSearch.visibility = state.bindings.Visibility.Visible;
  const searchWidth = Math.round(searchWidthDip * scale);
  const searchRight = titleWidth - Math.round(titleSearchMargin * scale);
  const searchLeft = searchRight - searchWidth;
  state.appWindow.titleBar.setDragRectangles([
    { x: 0, y: 0, width: searchLeft, height: titleHeight },
    {
      x: searchRight,
      y: 0,
      width: Math.max(0, titleWidth - searchRight),
      height: titleHeight,
    },
  ].filter((rectangle) => rectangle.width > 0));
}

function setTheme(window, dark) {
  const state = stateByWindow.get(window);
  if (!state) {
    return;
  }

  state.root.requestedTheme = dark
    ? state.bindings.ElementTheme.Dark
    : state.bindings.ElementTheme.Light;
  state.menuRoot.requestedTheme = state.root.requestedTheme;
  state.contextRoot.requestedTheme = state.root.requestedTheme;
  const titleColor = dark
    ? { a: 255, r: 32, g: 32, b: 32 }
    : { a: 255, r: 243, g: 243, b: 243 };
  const foregroundColor = dark
    ? { a: 255, r: 255, g: 255, b: 255 }
    : { a: 255, r: 31, g: 31, b: 31 };
  const hoverColor = dark
    ? { a: 255, r: 51, g: 51, b: 51 }
    : { a: 255, r: 229, g: 229, b: 229 };
  const pressedColor = dark
    ? { a: 255, r: 64, g: 64, b: 64 }
    : { a: 255, r: 218, g: 218, b: 218 };
  state.shellSurface.background = createBrush(
    state.bindings,
    titleColor.a,
    titleColor.r,
    titleColor.g,
    titleColor.b
  );
  state.menuSurface.background = state.shellSurface.background;
  window.setBackgroundColor(dark ? '#202020' : '#f3f3f3');
  const appTitleBar = state.appWindow.titleBar;
  appTitleBar.preferredTheme = dark
    ? state.bindings.TitleBarTheme.Dark
    : state.bindings.TitleBarTheme.Light;
  appTitleBar.backgroundColor = titleColor;
  appTitleBar.buttonBackgroundColor = titleColor;
  appTitleBar.buttonForegroundColor = foregroundColor;
  appTitleBar.buttonHoverBackgroundColor = hoverColor;
  appTitleBar.buttonHoverForegroundColor = foregroundColor;
  appTitleBar.buttonPressedBackgroundColor = pressedColor;
  appTitleBar.buttonPressedForegroundColor = foregroundColor;
  appTitleBar.inactiveBackgroundColor = titleColor;
  appTitleBar.buttonInactiveBackgroundColor = titleColor;
  appTitleBar.buttonInactiveForegroundColor = foregroundColor;
  window.setTitleBarOverlay({
    color: dark ? '#202020' : '#f3f3f3',
    symbolColor: dark ? '#ffffff' : '#1f1f1f',
    height: overlayTitleBarHeight,
  });
}

function createShell(window, options, view) {
  const { bindings } = getRuntime();
  const hwnd = window.getNativeWindowHandle().readBigUInt64LE(0);
  const appWindow = bindings.AppWindow.getFromWindowId({ value: hwnd });
  appWindow.titleBar.extendsContentIntoTitleBar = true;
  const source = new bindings.DesktopWindowXamlSource();
  source.initialize({ value: hwnd });
  source.shouldConstrainPopupsToWorkArea = true;
  const menuSource = new bindings.DesktopWindowXamlSource();
  menuSource.initialize({ value: hwnd });
  menuSource.shouldConstrainPopupsToWorkArea = true;
  const contextSource = new bindings.DesktopWindowXamlSource();
  contextSource.initialize({ value: hwnd });
  contextSource.shouldConstrainPopupsToWorkArea = true;

  const root = new bindings.Grid();
  root.background = createBrush(bindings, 0, 0, 0, 0);
  const menuRoot = new bindings.Grid();
  menuRoot.background = createBrush(bindings, 0, 0, 0, 0);
  const contextRoot = new bindings.Grid();
  contextRoot.background = createBrush(bindings, 0, 0, 0, 0);

  const titleBarHeight = defaultTitleBarHeight;
  const shellHeightValue =
    options.winui?.shellHeight ?? titleBarHeight + defaultMenuHeight;
  const shellSurface = new bindings.Border();
  shellSurface.height = titleBarHeight;
  shellSurface.verticalAlignment = bindings.VerticalAlignment.Top;
  const menuSurface = new bindings.Border();
  menuSurface.height = shellHeightValue - titleBarHeight;
  menuSurface.verticalAlignment = bindings.VerticalAlignment.Top;

  const titleRow = new bindings.Grid();
  titleRow.height = titleBarHeight;

  const titleIcon = new bindings.Image();
  titleIcon.width = 16;
  titleIcon.height = 16;
  titleIcon.margin = thickness(16, 0, 0, 0);
  titleIcon.horizontalAlignment = bindings.HorizontalAlignment.Left;
  titleIcon.verticalAlignment = bindings.VerticalAlignment.Center;

  const titleText = createText(
    bindings,
    options.title ?? electron.app.name,
    12,
    600
  );
  titleText.margin = thickness(16, 0, 16, 0);
  titleText.horizontalAlignment = bindings.HorizontalAlignment.Left;

  const subtitle = createText(
    bindings,
    options.winui?.subtitle ?? 'ELECTRON + WINUI 3',
    10,
    600
  );
  subtitle.margin = thickness(210, 0, 12, 0);
  subtitle.horizontalAlignment = bindings.HorizontalAlignment.Left;
  subtitle.opacity = 0.62;

  const titleSearch = new bindings.AutoSuggestBox();
  titleSearch.height = 30;
  titleSearch.margin = thickness(0, 0, titleSearchMargin, 0);
  titleSearch.horizontalAlignment = bindings.HorizontalAlignment.Right;
  titleSearch.verticalAlignment = bindings.VerticalAlignment.Center;
  titleSearch.queryIcon = new bindings.SymbolIcon(bindings.Symbol.Find);
  titleSearch.visibility = bindings.Visibility.Collapsed;
  appendChildren(
    bindings,
    titleRow,
    titleIcon,
    titleText,
    subtitle,
    titleSearch
  );

  const menuBar = new bindings.MenuBar();
  menuBar.height = shellHeightValue - titleBarHeight;
  menuBar.horizontalAlignment = bindings.HorizontalAlignment.Stretch;

  shellSurface.child = titleRow;
  menuSurface.child = menuBar;
  appendChildren(bindings, root, shellSurface);
  appendChildren(bindings, menuRoot, menuSurface);
  source.content = root;
  menuSource.content = menuRoot;
  contextSource.content = contextRoot;
  contextSource.siteBridge.moveAndResize({ x: 0, y: 0, width: 1, height: 1 });

  const state = {
    appWindow,
    bindings,
    contextRoot,
    contextSource,
    dialogOpen: false,
    menuBar,
    menuAvailable: true,
    menuRoot,
    menuSource,
    menuSurface,
    menuSubscriptions: [],
    menuVisible: true,
    root,
    shellHeight: shellHeightValue,
    shellReady: false,
    shellSurface,
    source,
    subscriptions: [],
    subtitle,
    titleBarHeight,
    titleBarIcon: null,
    titleBarSearch: null,
    titleIcon,
    titleSearch,
    titleText,
    view,
    windowMenu: undefined,
  };
  stateByWindow.set(window, state);
  updateTitleBarIcon(state, options.winui?.icon);
  updateTitleBarSearch(window, options.winui?.searchBox);
  state.subscriptions.push(
    titleSearch.onTextChanged((sender, args) => {
      if (
        args.reason === bindings.AutoSuggestionBoxTextChangeReason.UserInput
      ) {
        window.emit('titlebar-search-changed', sender.text);
      }
    })
  );
  state.subscriptions.push(
    titleSearch.onQuerySubmitted((_sender, args) => {
      window.emit('titlebar-search-submitted', args.queryText);
    })
  );
  state.subscriptions.push(
    contextRoot.onPointerPressed(() =>
      setImmediate(() => hideMenuOverlay(window))
    )
  );
  state.subscriptions.push(
    registerMenuPopup(window, (menu, popupOptions) =>
      showContextMenu(window, menu, popupOptions)
    )
  );

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
  for (const eventName of FORWARDED_WEB_CONTENTS_EVENTS) {
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
  state.menuSource.close();
  state.contextSource.close();
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
      height: overlayTitleBarHeight,
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

WinUIWindow.prototype.setSubtitle = function setSubtitle(subtitle) {
  const state = stateByWindow.get(this);
  if (state) {
    state.subtitle.text = subtitle;
  }
};

WinUIWindow.prototype.getSubtitle = function getSubtitle() {
  return stateByWindow.get(this)?.subtitle.text ?? '';
};

WinUIWindow.prototype.setTitleBarIcon = function setTitleBarIcon(icon) {
  const state = stateByWindow.get(this);
  if (state) {
    updateTitleBarIcon(state, icon);
  }
};

WinUIWindow.prototype.getTitleBarIcon = function getTitleBarIcon() {
  return stateByWindow.get(this)?.titleBarIcon ?? null;
};

WinUIWindow.prototype.setTitleBarSearch = function setTitleBarSearch(options) {
  updateTitleBarSearch(this, options);
};

WinUIWindow.prototype.getTitleBarSearch = function getTitleBarSearch() {
  const state = stateByWindow.get(this);
  if (!state?.titleBarSearch) {
    return null;
  }
  return {
    ...state.titleBarSearch,
    text: state.titleSearch.text,
  };
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
