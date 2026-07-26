/**
 * Prosthetic Telemetry Studio — Renderer Process Adapter
 * macOS Edition — Frameless Window + Serial Picker + node-serialport bridge
 */

(function() {
  'use strict';

  const isElectron = typeof window !== 'undefined' && window.IS_ELECTRON === true;
  const hasElectronAPI = typeof window !== 'undefined' && !!window.electronAPI;

  console.log('[Renderer] Environment:', isElectron ? 'Electron' : 'Browser');
  console.log('[Renderer] Platform:', isElectron ? window.electronAPI.platform : navigator.platform);

  if (!isElectron || !hasElectronAPI) return;

  // ── node-serialport adapter ──
  // Check if node-serialport is available and set up bridge
  (async function initSerialPort() {
    try {
      const result = await window.electronAPI.serialport.available();
      if (result.available) {
        window.__serialPortAvailable = true;
        console.log('[Renderer] node-serialport available, will use for COM port access');

        // Set up data listener that feeds into the app's appendBytes
        window.electronAPI.serialport.onData((data) => {
          if (typeof appendBytes === 'function') {
            appendBytes(data);
          }
        });

        window.electronAPI.serialport.onError((msg) => {
          console.error('[SerialPort] Error:', msg);
          if (typeof logParser === 'function') {
            logParser('Serial error: ' + msg, 'err');
          }
        });

        window.electronAPI.serialport.onDisconnected(() => {
          S.transport = 'none';
          if (typeof disconnectAll === 'function') {
            disconnectAll();
          }
        });
      } else {
        window.__serialPortAvailable = false;
      }
    } catch (e) {
      window.__serialPortAvailable = false;
      console.log('[Renderer] node-serialport not available:', e.message);
    }
  })();

  // ── File Export Bridge ──
  window.downloadFileElectron = async function(content, mime, ext) {
    const p = collectParticipant();
    const slug = (p.subject_id || 'session').replace(/[^\w-]+/g, '_').slice(0, 40) || 'session';
    const isoSafe = new Date(S.sessionStart || Date.now()).toISOString().replace(/[:.]/g, '-');
    const defaultName = `${slug}_${isoSafe}.${ext}`;

    try {
      const result = await window.electronAPI.saveFile({
        defaultPath: defaultName,
        filters: [
          ext === 'csv' ? { name: 'CSV Files', extensions: ['csv'] } : { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (!result.canceled && result.filePath) {
        const writeResult = await window.electronAPI.writeFile(result.filePath, content);
        if (writeResult.success) {
          logParser(`Exported ${ext.toUpperCase()} to: ${result.filePath}`);
          window.electronAPI.showMessage({
            type: 'info', title: 'Export Complete', message: 'File saved successfully.', detail: result.filePath, buttons: ['OK']
          });
        } else {
          throw new Error(writeResult.error);
        }
      }
    } catch (err) {
      logParser(`Export failed: ${err.message}`, 'err');
      downloadFileFallback(content, mime, ext);
    }
  };

  window.downloadFileFallback = function(content, mime, ext) {
    const p = collectParticipant();
    const slug = (p.subject_id || 'session').replace(/[^\w-]+/g, '_').slice(0, 40) || 'session';
    const isoSafe = new Date(S.sessionStart || Date.now()).toISOString().replace(/[:.]/g, '-');
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}_${isoSafe}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  window.downloadFile = window.downloadFileElectron;

  // ── Serial Port Picker Overlay (for Web Serial API) ──
  let pickerOverlay = null;
  let pickerPortList = [];

  function createSerialPicker() {
    if (pickerOverlay) pickerOverlay.remove();

    pickerOverlay = document.createElement('div');
    pickerOverlay.id = 'electron-serial-picker';
    pickerOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); backdrop-filter: blur(12px);
      z-index: 99999; display: flex; align-items: center; justify-content: center;
      font-family: var(--font-ui), system-ui, sans-serif; animation: fadeIn 0.2s ease;
    `;

    pickerOverlay.innerHTML = `
      <div style="
        background: var(--bg-elevated); border: 1px solid var(--border-strong);
        border-radius: 16px; width: 480px; max-width: 90vw; max-height: 80vh;
        display: flex; flex-direction: column; box-shadow: 0 32px 64px rgba(0,0,0,0.5);
        overflow: hidden;
      ">
        <div style="padding: 20px 24px 16px; border-bottom: 1px solid var(--border);">
          <h2 style="margin:0;font-size:16px;font-weight:700;color:var(--text);">Select Serial Port</h2>
          <p style="margin:6px 0 0;font-size:12px;color:var(--text-secondary);">Choose the COM port for your prosthetic device</p>
        </div>
        <div id="serial-picker-list" style="padding: 12px; overflow-y: auto; max-height: 320px; display: flex; flex-direction: column; gap: 6px;">
          <div style="text-align:center;padding:40px 20px;color:var(--text-tertiary);">
            <div style="width:32px;height:32px;border:2px solid var(--border-strong);border-top-color:var(--accent);border-radius:50%;margin:0 auto 12px;animation:spin 1s linear infinite;"></div>
            <p style="font-size:13px;margin:0">Scanning for serial ports...</p>
          </div>
        </div>
        <div id="serial-picker-error" style="display:none;padding:12px 24px;color:var(--amber);font-size:12px;border-top:1px solid var(--border);background:var(--amber-soft);">
          No serial ports found. Make sure your device is connected and drivers are installed.
        </div>
        <div style="padding: 14px 24px; border-top: 1px solid var(--border); display: flex; gap: 10px; justify-content: flex-end;">
          <button id="sp-refresh" style="min-height:32px;padding:0 14px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text);font:inherit;font-size:12px;cursor:pointer;">Refresh</button>
          <button id="sp-cancel" style="min-height:32px;padding:0 14px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text);font:inherit;font-size:12px;cursor:pointer;">Cancel</button>
          <button id="sp-connect" style="min-height:32px;padding:0 14px;border-radius:6px;border:none;background:var(--accent);color:#fff;font:inherit;font-size:12px;font-weight:600;cursor:pointer;opacity:0.4;" disabled>Connect</button>
        </div>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0}to{opacity:1}}</style>
    `;

    document.body.appendChild(pickerOverlay);

    pickerOverlay.querySelector('#sp-cancel').addEventListener('click', () => {
      window.electronAPI.cancelSerialPort();
      closePicker();
    });

    pickerOverlay.querySelector('#sp-refresh').addEventListener('click', () => {
      window.electronAPI.cancelSerialPort();
      closePicker();
      setTimeout(() => { if (typeof connectUsb === 'function') connectUsb(); }, 100);
    });

    pickerOverlay.querySelector('#sp-connect').addEventListener('click', () => {
      const sel = pickerOverlay.querySelector('.sp-item.selected');
      if (sel) {
        window.electronAPI.selectSerialPort(sel.dataset.portId);
        closePicker();
      }
    });

    pickerOverlay.addEventListener('click', (e) => {
      if (e.target === pickerOverlay) {
        window.electronAPI.cancelSerialPort();
        closePicker();
      }
    });
  }

  function closePicker() {
    if (pickerOverlay) { pickerOverlay.remove(); pickerOverlay = null; }
    pickerPortList = [];
  }

  function renderPortList(portList) {
    pickerPortList = portList;
    const listEl = document.getElementById('serial-picker-list');
    const errorEl = document.getElementById('serial-picker-error');
    if (!listEl) return;

    if (!portList || portList.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:var(--text-tertiary);">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4;margin-bottom:10px"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M12 8v4M12 16h.01"/></svg>
          <p style="font-size:13px;margin:0">No serial ports detected.</p>
          <p style="font-size:11px;margin-top:4px;opacity:0.7">Connect your device and click Refresh.</p>
        </div>`;
      if (errorEl) errorEl.style.display = 'block';
      return;
    }

    if (errorEl) errorEl.style.display = 'none';

    listEl.innerHTML = portList.map((port, idx) => {
      const vendor = port.vendorId ? `VID:${port.vendorId}` : 'Unknown';
      const product = port.productId ? `PID:${port.productId}` : 'Unknown';
      const isSTLink = port.vendorId && port.vendorId.toLowerCase() === '0483';
      const badge = isSTLink ? `<span style="display:inline-flex;align-items:center;background:var(--green-soft);color:var(--green);padding:1px 7px;border-radius:999px;font-size:9px;font-weight:700;margin-left:6px;letter-spacing:0.02em">ST-LINK</span>` : '';
      return `
        <div class="sp-item" data-port-id="${port.portId}" style="
          background: var(--surface); border: 1.5px solid var(--border);
          border-radius: 10px; padding: 12px 14px; cursor: pointer;
          transition: all 0.15s ease; display: flex; align-items: center; gap: 10px;
        ">
          <div style="width:32px;height:32px;border-radius:8px;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-tertiary)"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px;color:var(--text);display:flex;align-items:center;">
              ${port.portName || `Port ${idx + 1}`}${badge}
            </div>
            <div style="font-size:11px;color:var(--text-tertiary);font-family:var(--font-mono);margin-top:2px;">
              ${vendor} · ${product}${port.displayName ? ' · ' + port.displayName : ''}
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--accent);opacity:0;transition:opacity 0.15s" class="sp-check"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.sp-item').forEach(item => {
      item.addEventListener('click', () => {
        listEl.querySelectorAll('.sp-item').forEach(i => {
          i.classList.remove('selected');
          i.style.borderColor = 'var(--border)';
          i.style.background = 'var(--surface)';
          i.querySelector('.sp-check').style.opacity = '0';
        });
        item.classList.add('selected');
        item.style.borderColor = 'var(--accent)';
        item.style.background = 'var(--accent-soft)';
        item.querySelector('.sp-check').style.opacity = '1';
        const btn = document.getElementById('sp-connect');
        btn.disabled = false;
        btn.style.opacity = '1';
      });
    });
  }

  // IPC listeners
  window.electronAPI.onSerialShowPicker((portList) => {
    console.log('[Renderer] serial-show-picker:', portList.length, 'ports');
    createSerialPicker();
    renderPortList(portList);
  });

  window.electronAPI.onSerialPortAdded((port) => {
    pickerPortList.push(port);
    renderPortList(pickerPortList);
  });

  window.electronAPI.onSerialPortRemoved((port) => {
    pickerPortList = pickerPortList.filter(p => p.portId !== port.portId);
    renderPortList(pickerPortList);
  });

})();
