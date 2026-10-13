/**
 * Hawr Gallery — Preload Script
 *
 * Exposes a small, locked-down `hawr` API on `window` to the renderer
 * via `contextBridge`. The renderer can call this to print with an
 * exact page size (in micrometers) and to enumerate installed printers.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hawr', {
  /**
   * Print the current web contents to a thermal/label printer.
   *
   * opts.silent: bool — true to print without showing a dialog
   * opts.deviceName: string — exact printer name (use listPrinters to see)
   * opts.pageSize: { width: micrometers, height: micrometers }
   *   - 38mm × 25mm  → { width: 38000,  height: 25000 }
   *   - 50mm × 25mm  → { width: 50000,  height: 25000 }
   *   - 40mm × 30mm  → { width: 40000,  height: 30000 }
   */
  print: (opts) => ipcRenderer.invoke('hawr:print', opts || {}),

  listPrinters: () => ipcRenderer.invoke('hawr:listPrinters'),

  openDataFolder: () => ipcRenderer.invoke('hawr:openDataFolder'),

  getInfo: () => ipcRenderer.invoke('hawr:getInfo'),

  // Daily backup helpers
  selectBackupFolder: () => ipcRenderer.invoke('hawr:selectBackupFolder'),
  runBackup: (opts) => ipcRenderer.invoke('hawr:runBackup', opts || {}),
  getLastBackup: (p) => ipcRenderer.invoke('hawr:getLastBackup', p),
  runAutoBackupIfDue: () => ipcRenderer.invoke('hawr:runAutoBackupIfDue'),
  openBackupFolder: (p) => ipcRenderer.invoke('hawr:openBackupFolder', p),
  saveBackupTarget: (p) => ipcRenderer.invoke('hawr:saveBackupTarget', p),
  downloadSqliteBackup: () => ipcRenderer.invoke('hawr:downloadSqliteBackup'),
  revealInFolder: (p) => ipcRenderer.invoke('hawr:revealInFolder', p),
});
