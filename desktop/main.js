const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket;
}

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://mqiofvksgipmowyfjqjn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xaW9mdmtzZ2lwbW93eWZqcWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwOTI1NTcsImV4cCI6MjA4MzY2ODU1N30.SRXzBegzmjvXcJHxIwH8sBSlWO6A2tsTC274wR-Ioe8";
const ALLOWED_SITES = new Set(["myrtle-beach-oceanfront", "south-beach"]);

let win = null;
let logFile = null;
let rendererRestarted = false;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map(v => {
    if (v instanceof Error) return v.stack || v.message;
    if (typeof v === "string") return v;
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  }).join(" ")}\n`;

  try { process.stdout.write(line); } catch (_) {}
  if (logFile) {
    try { fs.appendFileSync(logFile, line, "utf8"); } catch (_) {}
  }
}

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
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

async function requireUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) throw new Error("Your TourPulse session is not signed in.");
  return data.user;
}

async function getConfigs() {
  await requireUser();
  const { data, error } = await supabase.rpc("tp_get_my_eod_configs");
  if (error) throw error;

  return (Array.isArray(data) ? data : [])
    .filter(row => ALLOWED_SITES.has(String(row.site_key || "")))
    .map(row => ({
      site_key: String(row.site_key || ""),
      sheet_name: String(row.sheet_name || ""),
      excel_name: String(row.excel_name || ""),
      emp: String(row.emp || "")
    }));
}

ipcMain.handle("auth:sign-in", async (_event, args = {}) => {
  try {
    const emp = cleanEmp(args.emp);
    const pin = cleanPin(args.pin);

    try { await supabase.auth.signOut(); } catch (_) {}

    const { data, error } = await supabase.auth.signInWithPassword({
      email: `${emp}@f8.local`,
      password: `F8-${emp}-${pin}`
    });
    if (error) throw error;
    if (!data?.user) throw new Error("Sign in failed.");

    const configs = await getConfigs();
    if (!configs.length) {
      await supabase.auth.signOut();
      throw new Error("This employee is not configured for MBO or SBR End of Day.");
    }

    return {
      ok: true,
      user: {
        id: data.user.id,
        emp,
        first_name: String(data.user.user_metadata?.first_name || "Marketer")
      },
      configs
    };
  } catch (err) {
    log("sign-in error", err);
    return { ok: false, error: err?.message || "Sign in failed." };
  }
});

ipcMain.handle("auth:sign-out", async () => {
  try {
    await supabase.auth.signOut();
    return { ok: true };
  } catch (err) {
    log("sign-out error", err);
    return { ok: false, error: err?.message || "Sign out failed." };
  }
});

ipcMain.handle("eod:get", async (_event, args = {}) => {
  try {
    await requireUser();
    const site = cleanSite(args.site_key);
    const reportDate = cleanDate(args.report_date);

    const { data, error } = await supabase.rpc("tp_get_my_eod_submission_v2", {
      p_site_key: site,
      p_report_date: reportDate
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    return { ok: true, row: row || null };
  } catch (err) {
    log("eod:get error", err);
    return { ok: false, error: err?.message || "Could not load the EOD entry." };
  }
});

ipcMain.handle("eod:save", async (_event, args = {}) => {
  try {
    await requireUser();
    const site = cleanSite(args.site_key);
    const reportDate = cleanDate(args.report_date);

    const payload = {
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
    };

    const { data: submissionId, error } = await supabase.rpc("tp_submit_eod_v2", payload);
    if (error) throw error;

    let sync = { queued: false, synced: false, message: "Saved to TourPulse. Excel sync is pending." };

    try {
      const { data: syncData, error: syncError } = await supabase.functions.invoke("eod-sync", {
        body: { submission_id: submissionId }
      });

      if (syncError) {
        log("eod-sync invoke warning", syncError);
      } else if (syncData) {
        sync = {
          queued: !!syncData.queued,
          synced: !!syncData.synced,
          message: String(syncData.message || (syncData.queued ? "Sent to the EOD report sync queue." : "Saved to TourPulse."))
        };
      }
    } catch (syncErr) {
      log("eod-sync warning", syncErr);
    }

    return {
      ok: true,
      submission_id: submissionId,
      sync
    };
  } catch (err) {
    log("eod:save error", err);
    return { ok: false, error: err?.message || "Could not save the EOD entry." };
  }
});

ipcMain.handle("app:open-full-eod", async () => {
  await shell.openExternal("https://feightrix.github.io/TourPulse/eod-tracker.html");
  return { ok: true };
});

ipcMain.handle("app:get-log-path", async () => ({ ok: true, path: logFile || "" }));

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

  win.webContents.on("render-process-gone", (_event, details) => {
    log("renderer process gone", details);
    if (!rendererRestarted && win && !win.isDestroyed()) {
      rendererRestarted = true;
      setTimeout(() => {
        if (win && !win.isDestroyed()) {
          win.loadFile(path.join(__dirname, "index.html")).catch(err => log("renderer reload failed", err));
        }
      }, 400);
    }
  });

  win.on("unresponsive", () => log("window unresponsive"));
  win.on("responsive", () => log("window responsive"));
  win.on("closed", () => {
    log("window closed");
    win = null;
  });

  win.loadFile(path.join(__dirname, "index.html"))
    .then(() => log("local desktop UI loaded"))
    .catch(err => log("loadFile failed", err));
}

process.on("uncaughtException", err => log("uncaughtException", err));
process.on("unhandledRejection", err => log("unhandledRejection", err));

app.whenReady().then(() => {
  logFile = path.join(app.getPath("userData"), "quick-eod.log");
  log("app ready", { version: app.getVersion(), userData: app.getPath("userData") });
  app.setAppUserModelId("com.f8.tourpulse.quickeod");
  createWindow();

  app.on("activate", () => {
    if (!win) createWindow();
    else {
      win.show();
      win.focus();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
