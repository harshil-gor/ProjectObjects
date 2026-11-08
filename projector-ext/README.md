# SE3 Robo Projector (Chrome Extension)

Unpacked Manifest V3 extension that overlays SE3 task layouts onto a Magcubic HY450 UST projector without modifying the station repo.

## Files

| File | World | Role |
|---|---|---|
| `manifest.json` | — | MV3, matches console origins |
| `injected.js` | **MAIN** @ `document_start` | Wraps `EventSource` + `fetch`, owns projector popup + metre-space SVG + `matrix3d` warp |
| `content.js` | isolated @ `document_idle` | Floating control bar on the console |

## Load in Firefox (station PC)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select this file (not the folder):
   `projector-ext/manifest.json`
4. Open / refresh the station console (`http://127.0.0.1:8765/…`)
5. Allow popups for that site if Firefox asks
6. Floating panel → **Open projector** → **Fullscreen on HDMI**

Temporary add-ons are removed when Firefox restarts — load `manifest.json` again after a reboot.

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the whole `projector-ext` folder
4. Open / refresh the station console
5. Floating panel → **Open projector** → **Fullscreen on HDMI**

## Local laptop smoke test (no robot)

With no station daemon available, use the mock bridge:

```powershell
# terminal 1
python C:\Users\harsh\OneDrive\Desktop\work\ProjectObjects\projector-ext\mock_bridge.py

# terminal 2 (optional — real console UI)
cd C:\Users\harsh\OneDrive\Desktop\work\SE3\se3labs\apps\local\station_endpoint
npm run dev

# terminal 3 — automated checks
cd C:\Users\harsh\OneDrive\Desktop\work\ProjectObjects\projector-ext
node smoke.mjs
```

Or open the harness page directly: `http://127.0.0.1:8765/smoke.html`
(loads the same `injected.js` / `content.js` as the extension).

## Windows display setup (critical)

The HY450 must be a **separate** Windows display, not a mirror of your desktop.

1. Press `Win + P`
2. Choose **Extend** (not Duplicate)
3. Confirm in Settings → System → Display that the projector is its own rectangle
4. In the extension panel click **Open projector**, then **Fullscreen on HDMI**
5. Only that black Chrome popup should live on the projector — keep the console on your laptop/monitor

Duplicate mode is why the projector was showing your full desktop. The extension cannot override OS mirroring; Extend is required on the robot station PC too.

## Projector setup

1. Turn **OFF** the HY450 built-in digital keystone
2. Click **Calibrate 4 corners**
3. Drag the four red pins on the projector onto the physical table corners:
   1. Back-Left (0, 0)
   2. Back-Right (1.2, 0)
   3. Front-Right (1.2, 0.65)
   4. Front-Left (0, 0.65)
4. Use Flip X / Flip Y if axes are mirrored
5. Fine-tune from the console panel if needed
6. Exit calibration — pins hide; warp stays saved in `localStorage`

## Runtime behaviour

- Layout shows only when: not blanked, `program.phase === "scene"`, `prompt.kind === "scene_ready"`, and `layout` is present
- Geometry is table **metres** (camera `homography` is ignored)
- Clicking **Start episode** (`answers.scene_ready === true`) blanks the projector to `#000`, waits **65 ms**, then lets `POST /api/command` proceed
- Leaving scene / scene_ready forces blank again

## Debug

In the console page DevTools:

```js
window.__ROBO_PROJECTOR__.getState()
```
