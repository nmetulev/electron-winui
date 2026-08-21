const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('example', {
  showDialog: () => ipcRenderer.invoke('show-winui-dialog'),
});
