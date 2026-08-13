// ── Electron main process ─────────────────────────────────────────────────────
// Loads the HATS web UI served by the Express backend on localhost:3001.
// Run with: npx electron .

import { app, BrowserWindow } from 'electron';

const BACKEND_URL = 'http://localhost:3001';

function createWindow() {
  const win = new BrowserWindow({
    width:  1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL(BACKEND_URL);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
