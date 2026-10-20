const { contextBridge, ipcRenderer, webUtils } = require('electron');
const subscribe = channel => callback => {
  const listener = (_event, payload) => callback(payload); ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('pbEditor', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'), notifyReady: () => ipcRenderer.send('renderer:ready'),
  createDocument: type => ipcRenderer.invoke('document:create', type), syncDocument: data => ipcRenderer.invoke('document:sync', data),
  openDocument: p => ipcRenderer.invoke('document:open', p), chooseFiles: () => ipcRenderer.invoke('file:choose'),
  saveDocument: data => ipcRenderer.invoke('document:save', data), closeDocument: id => ipcRenderer.invoke('document:close', id),
  reloadDocument: data => ipcRenderer.invoke('document:reload', data), moveDocument: data => ipcRenderer.invoke('document:move', data),
  listWindows: () => ipcRenderer.invoke('windows:list'), getPathForFile: file => webUtils.getPathForFile(file),
  setTabGeometry: rect => ipcRenderer.send('tabs:geometry', rect), startDrag: id => ipcRenderer.invoke('tabs:drag-start', id),
  updateDrag: () => ipcRenderer.send('tabs:drag-update'), endDrag: canceled => ipcRenderer.invoke('tabs:drag-end', canceled),
  respond: data => ipcRenderer.send('window:response', data), showMessage: options => ipcRenderer.invoke('dialog:message', options),
  onRequest: subscribe('window:request'), onRecover: subscribe('document:recover'), onActivate: subscribe('document:activate'),
  onRemove: subscribe('document:remove'), onUnlock: subscribe('document:unlock'), onSaved: subscribe('document:saved'),
  onFileChanged: subscribe('file:changed'), onError: subscribe('app:error'), onTabHint: subscribe('tabs:hint')
});
