const { app, BrowserWindow, screen, shell } = require("electron");

const APP_URL = "https://feightrix.github.io/TourPulse/quick-eod.html?desktop=1";
let win = null;

function createWindow(){
  const area = screen.getPrimaryDisplay().workArea;
  const width = 390;
  const height = 560;

  win = new BrowserWindow({
    width,
    height,
    minWidth: 350,
    minHeight: 500,
    x: Math.max(area.x, area.x + area.width - width - 18),
    y: Math.max(area.y, area.y + 70),
    show: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: "#f4f8fa",
    title: "TourPulse Quick EOD",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  win.setAlwaysOnTop(true, "floating");
  win.setMenuBarVisibility(false);

  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (_) {}

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("https://feightrix.github.io/TourPulse/")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.once("ready-to-show", () => win.show());
  win.loadURL(APP_URL);
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.f8.tourpulse.quickeod");
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (win) win.show();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
