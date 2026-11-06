const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

let backend;
let closing = false;
let ready = false;

async function loginPath() {
  if (process.platform === 'win32') return process.env.PATH;
  return new Promise((resolve) => {
    execFile(
      process.env.SHELL || '/bin/zsh',
      ['-ilc', 'printf "%s" "$PATH"'],
      { timeout: 5000 },
      (error, stdout) => {
        resolve(error ? process.env.PATH : stdout.trim().split('\n').at(-1));
      },
    );
  });
}

async function launch() {
  const root = path.join(__dirname, '..');
  const executablePath = await loginPath();
  const url = await new Promise((resolve, reject) => {
    backend = spawn(
      process.execPath,
      [path.join(root, 'dist', 'cli.js'), 'serve', '--port', '0', '--cwd', os.homedir()],
      {
        env: { ...process.env, PATH: executablePath, ELECTRON_RUN_AS_NODE: '1' },
        cwd: app.isPackaged ? process.resourcesPath : root,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let buffer = '';
    let errors = '';
    const timeout = setTimeout(() => {
      backend.kill();
      reject(new Error('The local engine did not start within 20 seconds.'));
    }, 20000);
    backend.stderr.on('data', (chunk) => {
      errors = (errors + chunk).slice(-4000);
    });
    backend.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    backend.on('exit', () => {
      clearTimeout(timeout);
      if (!ready) reject(new Error(errors || 'The local engine stopped during startup.'));
      else if (!closing) {
        dialog.showErrorBox('Engine stopped', errors || 'Restart oh-my-adaptor to reconnect.');
        app.quit();
      }
    });
    backend.stdout.on('data', (chunk) => {
      buffer += chunk;
      const match = buffer.match(/OMA_READY (\{[^\n]+\})/);
      if (match && !ready) {
        ready = true;
        clearTimeout(timeout);
        resolve(JSON.parse(match[1]).url);
      }
    });
  });
  const window = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 900,
    minHeight: 650,
    title: 'oh-my-adaptor',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#f8f9f6',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('https://')) void shell.openExternal(target);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== url) event.preventDefault();
  });
  ipcMain.handle('choose-directory', async (event) => {
    if (event.sender !== window.webContents) return null;
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Choose your project',
    });
    return result.canceled ? null : result.filePaths[0];
  });
  await window.loadURL(url);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app
    .whenReady()
    .then(launch)
    .catch((error) => {
      dialog.showErrorBox('Could not start oh-my-adaptor', error.message);
      app.quit();
    });
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      window.restore();
      window.focus();
    }
  });
}
app.on('window-all-closed', () => app.quit());
process.on('SIGTERM', () => app.quit());
process.on('SIGINT', () => app.quit());
app.on('before-quit', (event) => {
  if (backend && backend.exitCode === null && !closing) {
    event.preventDefault();
    closing = true;
    const timeout = setTimeout(() => {
      backend.kill('SIGKILL');
      app.quit();
    }, 5000);
    backend.once('exit', () => {
      clearTimeout(timeout);
      app.quit();
    });
    backend.kill('SIGTERM');
  }
});
