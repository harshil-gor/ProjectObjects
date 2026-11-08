# ProjectObjects

External Magcubic HY450 table projector overlay for the SE3 station console.

Clone this repo on the TeleOp / Eval PC, then load the unpacked Chrome extension from `projector-ext/`.

## On the station PC

```bash
git clone https://github.com/harshil-gor/ProjectObjects.git
```

### Firefox (typical on the station PC)

1. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…**
2. Choose **`projector-ext/manifest.json`** (the file, not the folder)
3. `Win + P` → **Extend** (not Duplicate)
4. Open / refresh the station console
5. Floating panel → **Open projector** → **Fullscreen on HDMI** → calibrate

Temporary add-ons vanish after Firefox restarts — reload `manifest.json` again.

### Chrome

1. `chrome://extensions` → Developer mode → **Load unpacked** → select the `projector-ext` folder
2. Then same Extend / Open projector / calibrate steps

HY450 digital keystone must be **OFF**.

See [`projector-ext/README.md`](projector-ext/README.md) for details.
