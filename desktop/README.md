# TourPulse Quick EOD Desktop

The Windows Quick EOD app is a compact TourPulse entry client for MBO and SBR.

## Behavior

- Always on top
- Registers itself to launch automatically when the current Windows user signs in
- Prevents duplicate app instances if Windows startup and a manual launch happen together
- Uses the same TourPulse employee number + PIN
- Saves Seen, Booked, and Bounce Back values directly to TourPulse
- Feeds the native TourPulse EOD Dashboard from the same saved record
- No Excel or Power Automate sync is required
- Clear All requires a native confirmation and then saves zeros for every EOD value on the selected site/date
- Opens the full TourPulse EOD page when needed
- Arrival Probe can be run manually during one real TSW/OLAS check-in to capture foreground app transitions and save a redacted diagnostic JSON file to Downloads

## Local development

```bash
cd desktop
npm install
npm start
```

## Windows build

```bash
cd desktop
npm install
npm run dist
```

Build outputs are written to `desktop/dist`.

The GitHub Actions workflow builds the portable Windows EXE whenever desktop files are merged to `main`.


## Reliable Windows startup / deployment

Version 1.7.0 verifies a per-user HKCU Run entry every time the packaged app launches, while retaining Electron's login-item setting as a fallback.

For deployment, use `Install-or-Patch-TourPulse.cmd` together with the packaged `TourPulse Quick EOD.exe`:
- if the app already exists in the standard Local AppData location, it patches/replaces it
- if it does not exist, it installs the full app to `%LOCALAPPDATA%\Programs\TourPulse Quick EOD\TourPulse Quick EOD.exe`
- it registers both the HKCU Run entry and a Startup-folder fallback
- it requires no administrator rights

`Repair-TourPulse-Startup.cmd` is a lightweight startup-only repair for existing copies.
