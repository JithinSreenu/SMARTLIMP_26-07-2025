const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

// ============================================================================
// STATE
// ============================================================================
let mainWindow = null;
let serialPort = null;
let serialParser = null;
let isConnected = false;

// ============================================================================
// WINDOW CREATION
// ============================================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    title: 'Prosthetic Limb Telemetry Studio',
    icon: path.join(__dirname, '../assets/icon.png'),
    show: false, // Show after ready-to-show to prevent flash
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      // Enable experimental features for Web Serial fallback
      experimentalFeatures: true
    }
  });

  // Load the app
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Uncomment for DevTools during development:
    // mainWindow.webContents.openDevTools();
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    disconnectSerial();
  });
}

// ============================================================================
// SERIAL PORT MANAGEMENT (via node-serialport — more reliable than Web Serial in Electron)
// ============================================================================

async function listSerialPorts() {
  try {
    const ports = await SerialPort.list();
    return ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer || 'Unknown',
      serialNumber: p.serialNumber || '',
      vendorId: p.vendorId || '',
      productId: p.productId || ''
    }));
  } catch (err) {
    console.error('Error listing ports:', err);
    return [];
  }
}

async function connectSerial(event, { path: portPath, baudRate = 115200 }) {
  if (serialPort && serialPort.isOpen) {
    await disconnectSerial();
  }

  return new Promise((resolve, reject) => {
    try {
      serialPort = new SerialPort({
        path: portPath,
        baudRate: parseInt(baudRate, 10),
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        autoOpen: false
      });

      serialPort.open((err) => {
        if (err) {
          reject({ success: false, error: err.message });
          return;
        }

        isConnected = true;

        // Raw binary data handler — forward to renderer
        serialPort.on('data', (data) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            // Send as ArrayBuffer for zero-copy transfer
            mainWindow.webContents.send('serial:data', Buffer.from(data));
          }
        });

        serialPort.on('error', (err) => {
          console.error('Serial error:', err);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('serial:error', err.message);
          }
        });

        serialPort.on('close', () => {
          isConnected = false;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('serial:disconnected');
          }
        });

        resolve({
          success: true,
          path: portPath,
          baudRate: baudRate
        });
      });
    } catch (err) {
      reject({ success: false, error: err.message });
    }
  });
}

async function disconnectSerial() {
  isConnected = false;
  if (serialPort) {
    if (serialPort.isOpen) {
      await new Promise((resolve) => {
        serialPort.close((err) => {
          if (err) console.error('Error closing port:', err);
          resolve();
        });
      });
    }
    serialPort.removeAllListeners();
    serialPort = null;
  }
  return { success: true };
}

async function writeSerial(event, data) {
  if (!serialPort || !serialPort.isOpen) {
    return { success: false, error: 'Not connected' };
  }
  return new Promise((resolve) => {
    // data can be string or Uint8Array
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
    serialPort.write(buffer, (err) => {
      if (err) resolve({ success: false, error: err.message });
      else serialPort.drain(() => resolve({ success: true }));
    });
  });
}

// ============================================================================
// IPC HANDLERS
// ============================================================================

function setupIpc() {
  // Serial port IPC
  ipcMain.handle('serial:list', listSerialPorts);
  ipcMain.handle('serial:connect', connectSerial);
  ipcMain.handle('serial:disconnect', disconnectSerial);
  ipcMain.handle('serial:write', writeSerial);

  // File system operations for exports
  ipcMain.handle('dialog:saveFile', async (event, { defaultPath, filters }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters: filters || [
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    return result;
  });

  ipcMain.handle('dialog:showMessage', async (event, options) => {
    return await dialog.showMessageBox(mainWindow, options);
  });

  // App info
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  // BLE placeholder — Web Bluetooth can work in Electron with permissions
  ipcMain.handle('ble:requestDevice', async () => {
    // BLE in Electron requires experimental approach or native module
    // For now, return info that renderer should use navigator.bluetooth
    return {
      supported: true,
      note: 'Use Web Bluetooth API directly in renderer with proper permissions'
    };
  });
}

// ============================================================================
// APP LIFECYCLE
// ============================================================================

app.whenReady().then(() => {
  setupIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  disconnectSerial();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  disconnectSerial();
});

// Security: prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});
