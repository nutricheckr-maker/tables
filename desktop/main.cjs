// tables desktop — runs the Next.js standalone server inside Electron's main
// process on 127.0.0.1 and opens one window on it.
//
// The port is fixed when free, so the window's origin (and with it the
// localStorage mirror and service worker) stays the same between launches.
// Progress is kept in the platform's user-data folder (see server-file.ts).

const { app, BrowserWindow, dialog, shell } = require("electron");
const net = require("node:net");
const path = require("node:path");

const HOST = "127.0.0.1";
const PREFERRED_PORT = 5171;

if (!app.requestSingleInstanceLock()) app.quit();

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, HOST, () => srv.close(() => resolve(true)));
  });
}

function randomPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, HOST, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect(port, HOST);
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error("tables server did not start"));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

async function startServer() {
  const port = (await portFree(PREFERRED_PORT)) ? PREFERRED_PORT : await randomPort();
  const serverDir = app.isPackaged
    ? path.join(process.resourcesPath, "server")
    : path.join(__dirname, "..", ".next-desktop", "standalone");

  process.env.PORT = String(port);
  process.env.HOSTNAME = HOST;
  process.env.NODE_ENV = "production";
  process.env.XDG_STATE_HOME = app.getPath("userData");
  require(path.join(serverDir, "server.js"));

  await waitForServer(port);
  return `http://${HOST}:${port}`;
}

let win = null;

function createWindow(url) {
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 400,
    minHeight: 500,
    backgroundColor: "#0c0c0d",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Links to other sites open in the default browser, not in the app.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(url)) shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });
  win.loadURL(url);
}

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  let url;
  try {
    url = await startServer();
  } catch (err) {
    dialog.showErrorBox("Tables could not start", String(err && err.stack ? err.stack : err));
    app.quit();
    return;
  }
  createWindow(url);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
