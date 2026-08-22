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
void window.loadURL('https://example.com');
window.reload();
void window.capturePage();
void window.webContents;
window.setMenu(Menu.buildFromTemplate([]));
window.removeMenu();
window.setMenuBarVisibility(false);
void window.isMenuBarVisible();
window.setSubtitle('UPDATED TYPE TEST');
window.setTitleBarIcon(null);
window.setTitleBarSearch({ text: 'query' });
window.on('enter-html-full-screen', () => {});
window.on('leave-html-full-screen', () => {});
window.on('page-title-updated', (event, title, explicitSet) => {
  void event;
  void title;
  void explicitSet;
});
window.on('ready-to-show', () => {});
window.on('responsive', () => {});
window.on('titlebar-search-changed', (text) => void text);
window.on('titlebar-search-submitted', (query) => void query);
window.on('unresponsive', () => {});
void window.getSubtitle();
void window.getTitleBarIcon();
void window.getTitleBarSearch();
void WinUIWindow.fromId(window.id);
void WinUIWindow.fromWebContents(window.webContents);
void WinUIWindow.getAllWindows();
void WinUIWindow.getFocusedWindow();
void BrowserWindow.fromWebContents(electronWindow.webContents);
void dialog.showMessageBox(window, {
  message: 'Typed WinUI dialog',
});
