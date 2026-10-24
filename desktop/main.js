const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const SUPABASE_URL = "https://mqiofvksgipmowyfjqjn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xaW9mdmtzZ2lwbW93eWZqcWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwOTI1NTcsImV4cCI6MjA4MzY2ODU1N30.SRXzBegzmjvXcJHxIwH8sBSlWO6A2tsTC274wR-Ioe8";
const ALLOWED_SITES = new Set(["myrtle-beach-oceanfront", "south-beach"]);

let win = null;
let userDataLog = "";
let accessToken = "";
let refreshToken = "";
let expiresAtMs = 0;
let signedInUser = null;
let arrivalProbeProcess = null;
let arrivalProbeStartedAt = null;
let arrivalProbeEvents = [];
let arrivalProbeBuffer = "";
let arrivalProbeLastSignature = "";

const bootLog = path.join(os.tmpdir(), "TourPulse-Quick-EOD-startup.log");

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

function writeLogLine(line) {
  try { fs.appendFileSync(bootLog, line, "utf8"); } catch (_) {}
  if (userDataLog) {
    try { fs.appendFileSync(userDataLog, line, "utf8"); } catch (_) {}
  }
}

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map(v => {
    if (v instanceof Error) return v.stack || v.message;
    if (typeof v === "string") return v;
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  }).join(" ")}\n`;
  try { process.stdout.write(line); } catch (_) {}
  writeLogLine(line);
}

function fatal(title, err) {
  const message = err instanceof Error ? (err.stack || err.message) : String(err || "Unknown error");
  log(title, message);
  try { dialog.showErrorBox(title, message); } catch (_) {}
}

process.on("uncaughtException", err => fatal("TourPulse Quick EOD — Main Process Error", err));
process.on("unhandledRejection", err => fatal("TourPulse Quick EOD — Unhandled Error", err));

log("bootstrap", {
  node: process.versions.node,
  electron: process.versions.electron,
  chrome: process.versions.chrome
});

function cleanEmp(value) {
  const emp = String(value || "").trim();
  if (!/^\d{6}$/.test(emp)) throw new Error("Employee ID must be exactly 6 digits.");
  return emp;
}

function cleanPin(value) {
  const pin = String(value || "").trim();
  if (!/^\d{4}$/.test(pin)) throw new Error("PIN must be exactly 4 digits.");
  return pin;
}

function cleanSite(value) {
  const site = String(value || "").trim();
  if (!ALLOWED_SITES.has(site)) throw new Error("Quick EOD is available only for MBO and SBR.");
  return site;
}

function cleanDate(value) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid EOD date is required.");
  return date;
}

function cleanCount(value) {
  const n = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function clearSession() {
  accessToken = "";
  refreshToken = "";
  expiresAtMs = 0;
  signedInUser = null;
}

async function parseResponse(res) {
  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); }
    catch (_) { body = text; }
  }

  if (!res.ok) {
    const message =
      body?.msg ||
      body?.message ||
      body?.error_description ||
      body?.error ||
      (typeof body === "string" ? body : "") ||
      `Request failed with status ${res.status}`;
    throw new Error(String(message));
  }

  return body;
}

async function http(url, options = {}) {
  if (typeof fetch !== "function") {
    throw new Error("This Windows runtime does not provide the required network API.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("TourPulse connection timed out.");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshSessionIfNeeded() {
  if (!accessToken || !refreshToken) throw new Error("Sign in is required.");
  if (Date.now() < expiresAtMs - 120000) return;

  const res = await http(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh_token: refreshToken })
  });

  const data = await parseResponse(res);
  accessToken = String(data?.access_token || "");
  refreshToken = String(data?.refresh_token || refreshToken);
  expiresAtMs = Date.now() + Number(data?.expires_in || 3600) * 1000;

  if (!accessToken) throw new Error("TourPulse could not refresh the signed-in session.");
}

async function rpc(name, payload = {}) {
  await refreshSessionIfNeeded();

  const res = await http(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return await parseResponse(res);
}

async function getConfigs() {
  const data = await rpc("tp_get_my_eod_configs", {});
  return (Array.isArray(data) ? data : [])
    .filter(row => ALLOWED_SITES.has(String(row.site_key || "")))
    .map(row => ({
      site_key: String(row.site_key || ""),
      emp: String(row.emp || "")
    }));
}

ipcMain.handle("auth:sign-in", async (_event, args = {}) => {
  try {
    clearSession();

    const emp = cleanEmp(args.emp);
    const pin = cleanPin(args.pin);

    const res = await http(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: `${emp}@f8.local`,
        password: `F8-${emp}-${pin}`
      })
    });

    const data = await parseResponse(res);

    accessToken = String(data?.access_token || "");
    refreshToken = String(data?.refresh_token || "");
    expiresAtMs = Date.now() + Number(data?.expires_in || 3600) * 1000;
    signedInUser = data?.user || null;

    if (!accessToken || !refreshToken || !signedInUser) {
      clearSession();
      throw new Error("TourPulse sign in did not return a valid session.");
    }

    const configs = await getConfigs();

    if (!configs.length) {
      clearSession();
      throw new Error("This employee is not configured for MBO or SBR End of Day.");
    }

    log("sign-in success", { emp, sites: configs.map(x => x.site_key) });

    return {
      ok: true,
      user: {
        id: String(signedInUser.id || ""),
        emp,
        first_name: String(signedInUser.user_metadata?.first_name || "Marketer")
      },
      configs
    };
  } catch (err) {
    clearSession();
    log("sign-in error", err);
    return { ok: false, error: err?.message || "Sign in failed." };
  }
});

ipcMain.handle("auth:sign-out", async () => {
  clearSession();
  return { ok: true };
});

ipcMain.handle("eod:get", async (_event, args = {}) => {
  try {
    const site = cleanSite(args.site_key);
    const reportDate = cleanDate(args.report_date);

    const data = await rpc("tp_get_my_eod_submission_v2", {
      p_site_key: site,
      p_report_date: reportDate
    });

    const row = Array.isArray(data) ? data[0] : data;
    return { ok: true, row: row || null };
  } catch (err) {
    log("eod:get error", err);
    return { ok: false, error: err?.message || "Could not load the EOD entry." };
  }
});

ipcMain.handle("eod:save", async (_event, args = {}) => {
  try {
    const site = cleanSite(args.site_key);
    const reportDate = cleanDate(args.report_date);

    const submissionId = await rpc("tp_submit_eod_v2", {
      p_site_key: site,
      p_report_date: reportDate,
      p_vip_seen: cleanCount(args.vip_seen),
      p_vip_booked: cleanCount(args.vip_booked),
      p_ga_seen: cleanCount(args.ga_seen),
      p_ga_booked: cleanCount(args.ga_booked),
      p_goo_seen: cleanCount(args.goo_seen),
      p_goo_booked: cleanCount(args.goo_booked),
      p_rci_seen: cleanCount(args.rci_seen),
      p_rci_booked: cleanCount(args.rci_booked),
      p_renter_seen: cleanCount(args.renter_seen),
      p_renter_booked: cleanCount(args.renter_booked),
      p_bounce_back_booked: cleanCount(args.bounce_back_booked)
    });

    log("eod saved", { site, reportDate, submissionId });

    return {
      ok: true,
      submission_id: submissionId
    };
  } catch (err) {
    log("eod:save error", err);
    return { ok: false, error: err?.message || "Could not save the EOD entry." };
  }
});

ipcMain.handle("app:confirm-clear", async (_event, args = {}) => {
  try {
    const site = cleanSite(args.site_key);
    const reportDate = cleanDate(args.report_date);
    const siteLabel = site === "myrtle-beach-oceanfront"
      ? "MBO — Myrtle Beach Oceanfront"
      : "SBR — South Beach";

    const options = {
      type: "warning",
      title: "Clear this EOD day?",
      message: "Clear all EOD numbers for this day?",
      detail:
        siteLabel + " • " + reportDate +
        "\n\nThis will set every Seen, Booked, and Bounce Back value to 0 in TourPulse for the selected day. The dashboard will update from those zeros.",
      buttons: ["Cancel", "Clear All"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    };

    const result = win && !win.isDestroyed()
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options);

    return { ok: true, confirmed: result.response === 1 };
  } catch (err) {
    log("confirm clear error", err);
    return { ok: false, confirmed: false, error: err?.message || "Could not confirm Clear All." };
  }
});


function redactProbeTitle(value) {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b\d{4,}\b/g, "[number]")
    .slice(0, 220);
}

function stopArrivalProbeProcess() {
  if (!arrivalProbeProcess) return;
  try { arrivalProbeProcess.kill(); } catch (_) {}
  arrivalProbeProcess = null;
}

ipcMain.handle("probe:start", async () => {
  try {
    if (process.platform !== "win32") {
      return { ok: false, error: "Arrival Probe is currently available only on Windows." };
    }
    if (arrivalProbeProcess) {
      return { ok: true, already_running: true, started_at: arrivalProbeStartedAt };
    }

    arrivalProbeStartedAt = new Date().toISOString();
    arrivalProbeEvents = [];
    arrivalProbeBuffer = "";
    arrivalProbeLastSignature = "";

    const script = [
      "Add-Type -TypeDefinition @'",
      "using System;",
      "using System.Runtime.InteropServices;",
      "using System.Text;",
      "public static class TPWinProbe {",
      "  [DllImport(\\\"user32.dll\\\")] public static extern IntPtr GetForegroundWindow();",
      "  [DllImport(\\\"user32.dll\\\")] public static extern int GetWindowTextLength(IntPtr hWnd);",
      "  [DllImport(\\\"user32.dll\\\", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);",
      "  [DllImport(\\\"user32.dll\\\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);",
      "}",
      "'@",
      "while ($true) {",
      "  try {",
      "    $h = [TPWinProbe]::GetForegroundWindow()",
      "    if ($h -ne [IntPtr]::Zero) {",
      "      [uint32]$pid = 0",
      "      [void][TPWinProbe]::GetWindowThreadProcessId($h, [ref]$pid)",
      "      $len = [TPWinProbe]::GetWindowTextLength($h)",
      "      $sb = New-Object System.Text.StringBuilder ($len + 1)",
      "      [void][TPWinProbe]::GetWindowText($h, $sb, $sb.Capacity)",
      "      $p = Get-Process -Id $pid -ErrorAction SilentlyContinue",
      "      if ($p) {",
      "        [pscustomobject]@{",
      "          ts = (Get-Date).ToUniversalTime().ToString('o');",
      "          pid = [int]$pid;",
      "          process = [string]$p.ProcessName;",
      "          title = [string]$sb.ToString()",
      "        } | ConvertTo-Json -Compress",
      "      }",
      "    }",
      "  } catch {}",
      "  Start-Sleep -Milliseconds 250",
      "}"
    ].join("\n");

    arrivalProbeProcess = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );

    arrivalProbeProcess.stdout.setEncoding("utf8");
    arrivalProbeProcess.stdout.on("data", chunk => {
      arrivalProbeBuffer += String(chunk || "");
      const lines = arrivalProbeBuffer.split(/\r?\n/);
      arrivalProbeBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const row = JSON.parse(trimmed);
          const evt = {
            ts: String(row.ts || new Date().toISOString()),
            pid: Number(row.pid || 0),
            process: String(row.process || "").slice(0, 120),
            title: redactProbeTitle(row.title)
          };
          const signature = evt.pid + "|" + evt.process + "|" + evt.title;
          if (signature === arrivalProbeLastSignature) continue;
          arrivalProbeLastSignature = signature;
          arrivalProbeEvents.push(evt);

          if (arrivalProbeEvents.length > 1500) {
            arrivalProbeEvents.splice(0, arrivalProbeEvents.length - 1500);
          }
        } catch (_) {}
      }
    });

    arrivalProbeProcess.stderr.setEncoding("utf8");
    arrivalProbeProcess.stderr.on("data", chunk => {
      const msg = String(chunk || "").trim();
      if (msg) log("arrival probe stderr", msg.slice(0, 500));
    });

    arrivalProbeProcess.on("exit", (code, signal) => {
      log("arrival probe stopped", { code, signal, events: arrivalProbeEvents.length });
      arrivalProbeProcess = null;
    });

    log("arrival probe started", { startedAt: arrivalProbeStartedAt });
    return { ok: true, started_at: arrivalProbeStartedAt };
  } catch (err) {
    stopArrivalProbeProcess();
    log("arrival probe start error", err);
    return { ok: false, error: err?.message || "Could not start Arrival Probe." };
  }
});

ipcMain.handle("probe:stop", async (_event, args = {}) => {
  try {
    const site = cleanSite(args.site_key);
    const reportDate = cleanDate(args.report_date);
    const startedAt = arrivalProbeStartedAt || new Date().toISOString();

    stopArrivalProbeProcess();

    const endedAt = new Date().toISOString();
    const safeEmp = signedInUser?.email ? cleanEmp(String(signedInUser.email).split("@")[0]) : "";
    const payload = {
      format: "tourpulse-arrival-probe-v1",
      app_version: app.getVersion(),
      site_key: site,
      report_date: reportDate,
      employee_id: safeEmp,
      started_at: startedAt,
      ended_at: endedAt,
      computer: {
        platform: process.platform,
        release: os.release(),
        arch: process.arch,
        hostname: os.hostname()
      },
      note: "Foreground application transitions only. Window titles are locally redacted for email addresses and long numeric identifiers.",
      events: arrivalProbeEvents
    };

    const stamp = endedAt.replace(/[:.]/g, "-");
    const fileName = "TourPulse-Arrival-Probe-" + site + "-" + stamp + ".json";
    const filePath = path.join(app.getPath("downloads"), fileName);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");

    log("arrival probe saved", { filePath, events: arrivalProbeEvents.length });

    arrivalProbeStartedAt = null;
    arrivalProbeEvents = [];
    arrivalProbeBuffer = "";
    arrivalProbeLastSignature = "";

    return {
      ok: true,
      file_path: filePath,
      file_name: fileName,
      event_count: payload.events.length
    };
  } catch (err) {
    log("arrival probe stop error", err);
    return { ok: false, error: err?.message || "Could not save Arrival Probe." };
  }
});

ipcMain.handle("app:open-full-eod", async () => {
  await shell.openExternal("https://feightrix.github.io/TourPulse/eod-tracker.html");
  return { ok: true };
});

ipcMain.handle("app:get-log-path", async () => ({
  ok: true,
  userDataLog,
  bootLog
}));

function configureWindowsStartup() {
  if (process.platform !== "win32" || !app.isPackaged) return;

  try {
    const launchPath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    const startupArgs = ["--tourpulse-startup"];

    app.setLoginItemSettings({
      openAtLogin: true,
      path: launchPath,
      args: startupArgs
    });

    const settings = app.getLoginItemSettings({
      path: launchPath,
      args: startupArgs
    });

    log("windows startup registration", {
      launchPath,
      openAtLogin: !!settings.openAtLogin
    });
  } catch (err) {
    log("windows startup registration warning", err);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 430,
    height: 620,
    minWidth: 390,
    minHeight: 540,
    show: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: "#f4f8fa",
    title: "TourPulse Quick EOD",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  });

  win.setMenuBarVisibility(false);
  win.setAlwaysOnTop(true);

  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (_) {}

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", event => event.preventDefault());

  win.webContents.on("did-finish-load", () => log("desktop UI loaded"));
  win.webContents.on("render-process-gone", (_event, details) => {
    log("renderer process gone", details);
    if (win && !win.isDestroyed()) {
      try {
        dialog.showErrorBox(
          "TourPulse Quick EOD",
          "The display process stopped unexpectedly. Close the app and reopen it. A startup log was written to your TEMP folder."
        );
      } catch (_) {}
    }
  });

  win.on("unresponsive", () => log("window unresponsive"));
  win.on("responsive", () => log("window responsive"));
  win.on("closed", () => {
    log("window closed");
    win = null;
  });

  win.loadFile(path.join(__dirname, "index.html"))
    .catch(err => fatal("TourPulse Quick EOD — Display Error", err));
}

app.whenReady().then(() => {
  userDataLog = path.join(app.getPath("userData"), "quick-eod.log");
  log("app ready", {
    version: app.getVersion(),
    userData: app.getPath("userData")
  });

  app.setAppUserModelId("com.f8.tourpulse.quickeod");
  configureWindowsStartup();
  createWindow();

  app.on("activate", () => {
    if (!win) createWindow();
    else {
      win.show();
      win.focus();
    }
  });
}).catch(err => fatal("TourPulse Quick EOD — Startup Error", err));

app.on("before-quit", () => {
  stopArrivalProbeProcess();
});

app.on("window-all-closed", () => {
  app.quit();
});
