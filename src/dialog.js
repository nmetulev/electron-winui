const electron = require('electron');
const { isWinUIWindow, showMessageBox } = require('./window');

const dialog = Object.create(electron.dialog);

dialog.showMessageBox = (windowOrOptions, maybeOptions) => {
  if (isWinUIWindow(windowOrOptions)) {
    return showMessageBox(windowOrOptions, maybeOptions);
  }

  const focused = require('./window').WinUIWindow.getFocusedWindow();
  if (focused && maybeOptions === undefined) {
    return showMessageBox(focused, windowOrOptions);
  }

  return electron.dialog.showMessageBox(windowOrOptions, maybeOptions);
};

module.exports = {
  dialog,
};
