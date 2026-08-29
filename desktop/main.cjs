const { app, BrowserWindow, ipcMain, net, protocol, safeStorage, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { APP_ORIGIN, createStaticProtocolHandler } = require("./static-protocol.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      codeCache: true,
    },
  },
]);

let window;
let developmentOrigin = null;

function configuredDevelopmentOrigin() {
  if (app.isPackaged) return null;
  const configured = process.env.ASHWINI_DEV_SERVER_URL;
  if (!configured) return null;

  try {
    const url = new URL(configured);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    if (url.protocol !== "http:" || !loopback || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isTrustedRendererUrl(rawUrl) {
  try {
    const destination = new URL(rawUrl);
    if (developmentOrigin) return destination.origin === developmentOrigin;
    return destination.protocol === "app:"
      && destination.hostname === "ashwini"
      && !destination.port
      && !destination.username
      && !destination.password;
  } catch {
    return false;
  }
}

function assertTrustedSender(event) {
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl || !isTrustedRendererUrl(senderUrl)) throw new Error("Untrusted renderer origin.");
}

function stateFile() {
  return path.join(app.getPath("userData"), "ashwini-state.enc");
}

async function readEncryptedState(event) {
  assertTrustedSender(event);
  try {
    const encrypted = await fs.readFile(stateFile());
    if (!safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(encrypted));
  } catch {
    return null;
  }
}

async function writeEncryptedState(event, state) {
  assertTrustedSender(event);
  if (!safeStorage.isEncryptionAvailable()) throw new Error("OS encryption is unavailable; state was not saved.");
  if (!state || state.version !== 1) throw new Error("Invalid local state.");
  await fs.writeFile(stateFile(), safeStorage.encryptString(JSON.stringify(state)), { mode: 0o600 });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 880,
    minHeight: 640,
    title: "ashwini",
    backgroundColor: "#f7f9f6",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (developmentOrigin) {
    window.loadURL(developmentOrigin);
  } else {
    window.loadURL(`${APP_ORIGIN}/`);
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    let isLocalApp = false;

    try {
      const destination = new URL(url);
      isLocalApp = isTrustedRendererUrl(destination.toString());
    } catch {
      isLocalApp = false;
    }

    if (!isLocalApp) {
      event.preventDefault();
      if (url.startsWith("https:")) shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  developmentOrigin = configuredDevelopmentOrigin();
  ipcMain.handle("ashwini:state:load", readEncryptedState);
  ipcMain.handle("ashwini:state:save", writeEncryptedState);

  if (!developmentOrigin) {
    const outRoot = app.isPackaged
      ? path.join(process.resourcesPath, "app.asar", "out")
      : path.join(__dirname, "..", "out");
    protocol.handle("app", createStaticProtocolHandler({ outRoot, net }));
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
