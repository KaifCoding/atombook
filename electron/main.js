// Electron shell: serves the static Next.js export from out/ over a custom
// app:// origin so absolute asset paths, IndexedDB and the PDF worker all work offline.
const { app, BrowserWindow, protocol, net, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const OUT = path.join(__dirname, '..', 'out');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function resolveFile(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  let full = path.normalize(path.join(OUT, p));
  if (!full.startsWith(OUT)) return path.join(OUT, 'index.html'); // block path traversal
  if (!fs.existsSync(full) && fs.existsSync(full + '.html')) full += '.html';
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) full = path.join(full, 'index.html');
  return fs.existsSync(full) ? full : path.join(OUT, '404.html');
}

// Auto-update from the GitHub Release (Windows installer and Linux AppImage).
// Skipped in development and for the .deb (which cannot self-update).
function setupUpdates(win) {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-downloaded', (info) => {
      dialog
        .showMessageBox(win, {
          type: 'info',
          buttons: ['Restart now', 'Later'],
          defaultId: 0,
          message: `Atombook ${info.version} is ready to install`,
          detail: 'Restart to finish updating. Your data is kept.',
        })
        .then((r) => r.response === 0 && autoUpdater.quitAndInstall());
    });
    autoUpdater.on('error', (e) => console.error('update check failed:', e && e.message));
    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    check();
    setInterval(check, 6 * 60 * 60 * 1000);
  } catch (e) {
    console.error('updater unavailable:', e && e.message);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Atombook',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#f8fafc',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  setupUpdates(win);
  win.loadURL('app://billbook/'); // host name kept so data saved by earlier builds stays visible
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => net.fetch(pathToFileURL(resolveFile(new URL(req.url).pathname)).toString()));
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
