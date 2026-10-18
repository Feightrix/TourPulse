const { app, BrowserWindow, screen, shell } = require("electron");

const APP_URL = "https://feightrix.github.io/TourPulse/quick-eod.html?desktop=1&reauth=1";
let win = null;

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  function errorPage(message) {
    const safe = String(message || "Unable to reach TourPulse.")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `data:text/html;charset=utf-8,${encodeURIComponent(`
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>TourPulse Quick EOD</title>
        <style>
          body{margin:0;background:#f4f8fa;color:#0f172a;font-family:Segoe UI,Arial,sans-serif}
          .wrap{padding:24px}
          .card{background:#fff;border:1px solid rgba(15,23,42,.12);border-radius:18px;padding:20px;box-shadow:0 18px 45px rgba(2,6,23,.12)}
          h1{font-size:20px;margin:0 0 8px}
          p{font-size:13px;line-height:1.5;color:#64748b}
          button{border:1px solid rgba(10,166,181,.3);background:#eaf8fa;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer}
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="card">
            <h1>TourPulse Quick EOD</h1>
            <p>${safe}</p>
            <p>Check your internet connection, then close and reopen the app.</p>
          </div>
        </div>
      </body>
      </html>
    `)}`;
  }

  function createWindow(){
    const area = screen.getPrimaryDisplay().workArea;
    const width = 430;
    const height = 620;

    win = new BrowserWindow({
      width,
      height,
      minWidth: 390,
      minHeight: 540,
      x: Math.max(area.x, area.x + area.width - width - 18),
      y: Math.max(area.y, area.y + 60),
      show: true,
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
        webSecurity: true,
        spellcheck: false
      }
    });

    win.setAlwaysOnTop(true);
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

    win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      win.loadURL(errorPage(`Could not load TourPulse (${errorDescription || errorCode}).`)).catch(() => {});
    });

    win.on("closed", () => {
      win = null;
    });

    win.loadURL(APP_URL).catch(err => {
      if (win && !win.isDestroyed()) {
        win.loadURL(errorPage(err?.message || "Unable to load TourPulse.")).catch(() => {});
      }
    });
  }

  app.whenReady().then(() => {
    app.setAppUserModelId("com.f8.tourpulse.quickeod");
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else if (win) {
        win.show();
        win.focus();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
