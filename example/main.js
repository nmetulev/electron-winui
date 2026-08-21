const path = require('node:path');
const {
  app,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  WinUIWindow,
} = require('..');

let mainWindow;

const titleBarIdentities = {
  package: {
    icon: path.join(__dirname, 'electron-winui.svg'),
    subtitle: 'ELECTRON + WINUI 3',
  },
  project: {
    icon: path.join(__dirname, 'project.svg'),
    subtitle: 'LIVE TITLEBAR UPDATE',
  },
};

function themeState() {
  return {
    dark: nativeTheme.shouldUseDarkColors,
    source: nativeTheme.themeSource,
  };
}

function setTheme(source) {
  nativeTheme.themeSource = source;
  const state = themeState();
  mainWindow?.webContents.send('theme-changed', state);
  return state;
}

function showDialog() {
  return dialog.showMessageBox(mainWindow, {
    title: 'Native WinUI dialog',
    message: 'The Chromium page remains visible beneath this dialog.',
    detail: 'Theme, menus, and dialog chrome all come from WinUI 3.',
    buttons: ['Continue', 'Close'],
  });
}

function setTitleBarIdentity(identity) {
  const { icon, subtitle } = titleBarIdentities[identity];
  mainWindow?.setTitleBarIcon(icon);
  mainWindow?.setSubtitle(subtitle);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          {
            label: 'Show WinUI dialog',
            click: showDialog,
          },
          { label: 'Close', role: 'close' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { label: 'Use system theme', click: () => setTheme('system') },
          { label: 'Use light theme', click: () => setTheme('light') },
          { label: 'Use dark theme', click: () => setTheme('dark') },
          { type: 'separator' },
          { label: 'Reload', role: 'reload' },
          { label: 'Toggle Developer Tools', role: 'toggledevtools' },
        ],
      },
      {
        label: 'Title bar',
        submenu: [
          {
            label: 'Use package identity',
            click: () => setTitleBarIdentity('package'),
          },
          {
            label: 'Use project identity',
            click: () => setTitleBarIdentity('project'),
          },
        ],
      },
    ])
  );

  mainWindow = new WinUIWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    winui: {
      ...titleBarIdentities.package,
      searchBox: {
        placeholder: 'Search this demo',
        width: 320,
      },
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('titlebar-search-changed', (text) => {
    mainWindow.webContents.send('titlebar-search', { submitted: false, text });
  });
  mainWindow.on('titlebar-search-submitted', (text) => {
    mainWindow.webContents.send('titlebar-search', { submitted: true, text });
  });

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show native dialog',
      click: showDialog,
    },
    { type: 'separator' },
    {
      label: 'Use light theme',
      click: () => setTheme('light'),
    },
    {
      label: 'Use dark theme',
      click: () => setTheme('dark'),
    },
  ]);
  mainWindow.webContents.on('context-menu', (_event, params) => {
    contextMenu.popup({
      window: mainWindow,
      x: params.x,
      y: params.y,
    });
  });
});

ipcMain.handle('show-winui-dialog', showDialog);
ipcMain.handle('get-theme', themeState);
ipcMain.handle('set-theme', (_event, source) => setTheme(source));

app.on('window-all-closed', () => {
  app.quit();
});
