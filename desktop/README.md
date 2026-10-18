# TourPulse Quick EOD Desktop

This desktop wrapper opens the live TourPulse Quick EOD page in its own Windows application window.

## Behavior

- Always on top
- Opens near the right side of the primary monitor
- Uses the same TourPulse employee number + PIN
- Saves changes to TourPulse automatically after a short pause
- Sends the saved EOD submission through the existing TourPulse EOD sync function
- The existing Power Automate flow then updates the EOD Excel report for configured site branches
- Session is retained by Electron between launches

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

The GitHub Actions workflow also builds both a portable EXE and an NSIS installer.
