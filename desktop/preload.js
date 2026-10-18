const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tourPulseDesktop", {
  signIn: (emp, pin) => ipcRenderer.invoke("auth:sign-in", { emp, pin }),
  signOut: () => ipcRenderer.invoke("auth:sign-out"),
  getEod: (site_key, report_date) => ipcRenderer.invoke("eod:get", { site_key, report_date }),
  saveEod: payload => ipcRenderer.invoke("eod:save", payload),
  openFullEod: () => ipcRenderer.invoke("app:open-full-eod"),
  getLogPath: () => ipcRenderer.invoke("app:get-log-path")
});
