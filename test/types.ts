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

const electronWindow = new BrowserWindow({ show: false });
const window = new WinUIWindow({
  show: false,
  webPreferences: {
    contextIsolation: true,
  },
  winui: {
    icon: 'icon.svg',
    searchBox: {
      placeholder: 'Search type test',
      width: 320,
    },
    shellHeight: 96,
    subtitle: 'TYPE TEST',
  },
});

void window.loadFile('index.html');
void window.webContents;
window.setSubtitle('UPDATED TYPE TEST');
window.setTitleBarIcon(null);
window.setTitleBarSearch({ text: 'query' });
window.on('titlebar-search-changed', (text) => void text);
window.on('titlebar-search-submitted', (query) => void query);
void window.getSubtitle();
void window.getTitleBarIcon();
void window.getTitleBarSearch();
void WinUIWindow.fromWebContents(window.webContents);
void BrowserWindow.fromWebContents(electronWindow.webContents);
void dialog.showMessageBox(window, {
  message: 'Typed WinUI dialog',
});
