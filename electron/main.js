// Electron shell: serves the static Next.js export from out/ over a custom
// app:// origin so absolute asset paths, IndexedDB and the PDF worker all work offline.
const { app, BrowserWindow, protocol, net, Menu, shell } = require('electron');
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
