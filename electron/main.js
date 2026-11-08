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

// Update check: looks at the latest GitHub Release and offers the installer for this platform.
// electron/release.json ({ "repo": "owner/name" }) is written by the release workflow;
// it is absent in development, so nothing is checked there.
function setupUpdates(win) {
  if (!app.isPackaged) return;
  let repo;
  try {
    repo = require('./release.json').repo;
  } catch {
    return;
  }
  const ext = process.platform === 'win32' ? '.exe' : process.platform === 'linux' ? '.deb' : null;
  if (!repo || !ext) return;

  const parts = (v) => String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const isNewer = (a, b) => {
    const x = parts(a), y = parts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    }
    return false;
  };

  let offered = '';
  const check = async () => {
    try {
      const res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { 'User-Agent': 'Atombook', Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) return;
      const rel = await res.json();
      const asset = (rel.assets || []).find((x) => x.name.endsWith(ext));
      if (!asset || !isNewer(rel.tag_name, app.getVersion()) || offered === rel.tag_name) return;
      offered = rel.tag_name;
      const r = await dialog.showMessageBox(win, {
        type: 'info',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
        message: `Atombook ${String(rel.tag_name).replace(/^v/, '')} is available`,
        detail: 'Download the installer and run it to update. Your data is kept.',
      });
      if (r.response === 0) shell.openExternal(asset.browser_download_url);
    } catch {
      /* offline or rate limited: try again later */
    }
  };
  check();
  setInterval(check, 6 * 60 * 60 * 1000);
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
