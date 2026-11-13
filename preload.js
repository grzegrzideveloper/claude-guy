// The only bridge between renderer and main. Keep it narrow.
const { contextBridge, ipcRenderer } = require('electron');

const on = (ch, fn) => {
  const h = (_e, ...a) => fn(...a);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  storeGet: name => ipcRenderer.invoke('store:get', name),
  storeSave: (name, data) => ipcRenderer.invoke('store:save', name, data),
  pickFolder: () => ipcRenderer.invoke('session:pickFolder'),
  newSessionId: () => ipcRenderer.invoke('session:newId'),
  startSession: opts => ipcRenderer.invoke('session:start', opts),
  ptyWrite: (tabId, data) => ipcRenderer.send('pty:write', tabId, data),
  ptyResize: (tabId, cols, rows) => ipcRenderer.send('pty:resize', tabId, cols, rows),
  ptyKill: tabId => ipcRenderer.send('pty:kill', tabId),
  openExternal: url => ipcRenderer.invoke('open:external', url),
  clipboardWrite: text => ipcRenderer.invoke('clipboard:write', text),
  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),
  clickupStatus: () => ipcRenderer.invoke('clickup:status'),
  clickupConnect: token => ipcRenderer.invoke('clickup:connect', token),
  clickupSave: opts => ipcRenderer.invoke('clickup:save', opts),
  clickupDisconnect: () => ipcRenderer.invoke('clickup:disconnect'),
  clickupTasks: opts => ipcRenderer.invoke('clickup:tasks', opts),
  onPtyData: fn => on('pty:data', fn),
  onPtyExit: fn => on('pty:exit', fn),
  onSessionsChanged: fn => on('sessions:changed', fn),
});
