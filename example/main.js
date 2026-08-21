const path = require('node:path');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
} = require('..');

let mainWindow;

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          {
            label: 'Show WinUI dialog',
            click: () =>
              dialog.showMessageBox(mainWindow, {
                title: 'Native WinUI dialog',
                message: 'The Electron renderer stays unchanged.',
                detail:
                  'This dialog, the title area, and the menu are WinUI 3 controls.',
                buttons: ['Continue', 'Close'],
              }),
          },
          { label: 'Close', role: 'close' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { label: 'Reload', role: 'reload' },
          { label: 'Toggle Developer Tools', role: 'toggledevtools' },
        ],
      },
    ])
  );

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    winui: {
      subtitle: 'ONE IMPORT CHANGED',
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
});

ipcMain.handle('show-winui-dialog', () =>
  dialog.showMessageBox(mainWindow, {
    title: 'Native WinUI dialog',
    message: 'This ContentDialog came from the npm compatibility package.',
    buttons: ['OK'],
  })
);

app.on('window-all-closed', () => {
  app.quit();
});
