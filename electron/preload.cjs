const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopUpdater", {
  getStatus: () => ipcRenderer.invoke("desktop-updater:get-status"),
  checkForUpdates: () => ipcRenderer.invoke("desktop-updater:check"),
  startUpdate: () => ipcRenderer.invoke("desktop-updater:start"),
  onStatusChange: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("desktop-updater:status", listener);
    return () => {
      ipcRenderer.removeListener("desktop-updater:status", listener);
    };
  },
});
