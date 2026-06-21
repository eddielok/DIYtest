const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onStatus: (cb) => ipcRenderer.on('status', (_, v) => cb(v)),
  onAnswer: (cb) => ipcRenderer.on('answer', (_, v) => cb(v)),
  onCategory: (cb) => ipcRenderer.on('category', (_, v) => cb(v)),
  close: () => ipcRenderer.send('close'),
  scanNow: () => ipcRenderer.send('scan-now'),
  scanAll: () => ipcRenderer.send('scan-all'),
  togglePause: () => ipcRenderer.send('toggle-pause'),
  onPaused: (cb) => ipcRenderer.on('paused', (_, v) => cb(v)),
  sendScreen: (ip) => ipcRenderer.invoke('send-screen', ip),
  onRemoteAnalysis: (cb) => ipcRenderer.on('remote-analysis', (_, v) => cb(v)),
});
