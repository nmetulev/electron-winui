const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('example', {
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (source) => ipcRenderer.invoke('set-theme', source),
  showDialog: () => ipcRenderer.invoke('show-winui-dialog'),
  onThemeChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('theme-changed', listener);
    return () => ipcRenderer.removeListener('theme-changed', listener);
  },
  onTitleBarSearch: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('titlebar-search', listener);
    return () => ipcRenderer.removeListener('titlebar-search', listener);
  },
});
