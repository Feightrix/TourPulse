const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tourPulseDesktop", {
  signIn: (emp, pin) => ipcRenderer.invoke("auth:sign-in", { emp, pin }),
  signOut: () => ipcRenderer.invoke("auth:sign-out"),
  getEod: (site_key, report_date) => ipcRenderer.invoke("eod:get", { site_key, report_date }),
  saveEod: payload => ipcRenderer.invoke("eod:save", payload),
  confirmClear: (site_key, report_date) => ipcRenderer.invoke("app:confirm-clear", { site_key, report_date }),
  openFullEod: () => ipcRenderer.invoke("app:open-full-eod"),
  getLogPath: () => ipcRenderer.invoke("app:get-log-path")
});
