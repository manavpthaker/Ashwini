const { contextBridge } = require("electron");
const { ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ashwiniDesktop", Object.freeze({
  platform: process.platform,
  isDesktop: true,
  loadState: () => ipcRenderer.invoke("ashwini:state:load"),
  saveState: (state) => ipcRenderer.invoke("ashwini:state:save", state),
}));
