const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  chooseDirectory: () => ipcRenderer.invoke('choose-directory'),
});
