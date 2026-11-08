# ProjectObjects

External Magcubic HY450 table projector overlay for the SE3 station console.

Clone this repo on the TeleOp / Eval PC, then load the unpacked Chrome extension from `projector-ext/`.

## On the station PC

```bash
git clone https://github.com/harshil-gor/ProjectObjects.git
```

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked**
2. Select the `projector-ext` folder inside this repo
3. `Win + P` → **Extend** (not Duplicate)
4. Open the station console (`http://127.0.0.1:8765/` or the URL printed by `se3labs-station console`)
5. Floating panel → **Open projector** → **Fullscreen on HDMI** → calibrate 4 corners

HY450 digital keystone must be **OFF**.

See [`projector-ext/README.md`](projector-ext/README.md) for local smoke-test details.
