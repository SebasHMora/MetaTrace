// Puente mínimo y acotado entre la interfaz (index.html, aislada) y el proceso
// principal. Solo expone lo necesario para los respaldos automáticos a disco.
// No da acceso a Node ni al sistema de archivos en general.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('metatrace', {
  isDesktop: true,
  backupsDir: () => ipcRenderer.invoke('mt:backupsDir'),
  backupNow: (json) => ipcRenderer.invoke('mt:backupNow', json),
  listAutoBackups: () => ipcRenderer.invoke('mt:listBackups'),
  readAutoBackup: (name) => ipcRenderer.invoke('mt:readBackup', name),
  openBackupsFolder: () => ipcRenderer.invoke('mt:openFolder'),
});
