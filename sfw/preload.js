const { contextBridge, ipcRenderer } = require('electron');

// ============================================================================
// PRELOAD SCRIPT — Exposes safe APIs to the renderer process
// This is the ONLY way renderer can communicate with main process.
// ============================================================================

contextBridge.exposeInMainWorld('electronAPI', {
  // --------------------------------------------------------------------------
  // SERIAL PORT API
  // --------------------------------------------------------------------------
  serial: {
    /** List available serial ports */
    list: () => ipcRenderer.invoke('serial:list'),

    /** Connect to a serial port: { path, baudRate } */
    connect: (options) => ipcRenderer.invoke('serial:connect', options),

    /** Disconnect current serial port */
    disconnect: () => ipcRenderer.invoke('serial:disconnect'),

    /** Write data to serial port (string or Uint8Array) */
    write: (data) => ipcRenderer.invoke('serial:write', data),

    /** Listen for incoming serial data (returns cleanup function) */
    onData: (callback) => {
      const handler = (event, data) => {
        // data is a Node Buffer — convert to Uint8Array for the renderer
        callback(new Uint8Array(data));
      };
      ipcRenderer.on('serial:data', handler);
      // Return cleanup function
      return () => ipcRenderer.removeListener('serial:data', handler);
    },

    /** Listen for serial errors */
    onError: (callback) => {
      const handler = (event, message) => callback(message);
      ipcRenderer.on('serial:error', handler);
      return () => ipcRenderer.removeListener('serial:error', handler);
    },

    /** Listen for disconnection events */
    onDisconnected: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('serial:disconnected', handler);
      return () => ipcRenderer.removeListener('serial:disconnected', handler);
    }
  },

  // --------------------------------------------------------------------------
  // DIALOG API
  // --------------------------------------------------------------------------
  dialog: {
    saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
    showMessage: (options) => ipcRenderer.invoke('dialog:showMessage', options)
  },

  // --------------------------------------------------------------------------
  // APP INFO
  // --------------------------------------------------------------------------
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    platform: process.platform
  },

  // --------------------------------------------------------------------------
  // BLE INFO (Web Bluetooth still used in renderer, but this provides capability check)
  // --------------------------------------------------------------------------
  ble: {
    getInfo: () => ipcRenderer.invoke('ble:requestDevice')
  }
});

// Also expose a flag so the renderer knows it's running in Electron
contextBridge.exposeInMainWorld('IS_ELECTRON', true);
