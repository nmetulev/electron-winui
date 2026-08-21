import electronWinUI = require('../dist');

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  WinUIWindow,
} = electronWinUI;

void app;
void ipcMain;
void Menu;
void WinUIWindow;

const window = new BrowserWindow({
  show: false,
  webPreferences: {
    contextIsolation: true,
  },
  winui: {
    shellHeight: 96,
    subtitle: 'TYPE TEST',
  },
});

void window.loadFile('index.html');
void window.webContents;
void BrowserWindow.fromWebContents(window.webContents);
void dialog.showMessageBox(window, {
  message: 'Typed WinUI dialog',
});
