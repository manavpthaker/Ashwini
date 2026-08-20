const { app, BrowserWindow, ipcMain, safeStorage, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

let window;

function stateFile() {
  return path.join(app.getPath("userData"), "ashwini-state.enc");
}

async function readEncryptedState() {
  try {
    const encrypted = await fs.readFile(stateFile());
    if (!safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(encrypted));
  } catch {
    return null;
  }
}

async function writeEncryptedState(event, state) {
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
    backgroundColor: "#e9e5db",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  const localUrl = process.env.ASHWINI_DEV_SERVER_URL;
  if (localUrl) {
    window.loadURL(localUrl);
  } else {
    window.loadFile(path.join(process.resourcesPath, "app.asar", "out", "index.html"));
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const isLocalApp = localUrl ? url.startsWith(localUrl) : url.startsWith("file:");
    if (!isLocalApp) {
      event.preventDefault();
      if (url.startsWith("https:")) shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  ipcMain.handle("ashwini:state:load", readEncryptedState);
  ipcMain.handle("ashwini:state:save", writeEncryptedState);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
