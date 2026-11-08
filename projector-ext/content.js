/**
 * Isolated-world floating control bar for the SE3 Robo Projector.
 * Styled to match the SE3 operator console (light mono panels / outlined buttons).
 * Talks to injected.js via window CustomEvents.
 */
(() => {
  if (window.__ROBO_PROJECTOR_UI__) return;
  window.__ROBO_PROJECTOR_UI__ = true;

  const CORNER_LABELS = [
    { short: "1 BL", full: "Back-Left 0,0" },
    { short: "2 BR", full: "Back-Right 1.2,0" },
    { short: "3 FR", full: "Front-Right 1.2,0.65" },
    { short: "4 FL", full: "Front-Left 0,0.65" },
  ];

  let ui = {
    connected: false,
    show: false,
    recordingBlank: true,
    manualBlank: false,
    calibrating: false,
    flipX: false,
    flipY: false,
    corners: [
      { x: 0.08, y: 0.12 },
      { x: 0.92, y: 0.12 },
      { x: 0.92, y: 0.88 },
      { x: 0.08, y: 0.88 },
    ],
    phase: null,
    prompt: null,
    layoutId: null,
    objectCount: 0,
    projectorOpen: false,
  };

  let selectedCorner = 0;
  let root = null;
  let collapsed = false;
  let showAdvanced = false;

  function send(detail) {
    window.dispatchEvent(new CustomEvent("robo-projector-cmd", { detail }));
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "style" && typeof value === "object") Object.assign(node.style, value);
      else if (key === "className") node.className = value;
      else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value !== false && value != null) {
        node.setAttribute(key, value === true ? "" : String(value));
      }
    }
    for (const child of [].concat(children)) {
      if (child == null || child === false) continue;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  function btn(label, title, onClick, { tone = "outline", active = false, wide = false } = {}) {
    const className = [
      "rp-btn",
      tone === "fill" ? "rp-fill" : "",
      tone === "green" ? "rp-green" : "",
      active ? "rp-on" : "",
      wide ? "rp-wide" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return el("button", { type: "button", title, className, onClick }, label);
  }

  function kbd(text) {
    return el("span", { className: "rp-kbd" }, text);
  }

  function label(text) {
    return el("p", { className: "rp-label" }, text);
  }

  function statusLine() {
    if (!ui.connected) return { tone: "warn", text: "Connecting to page hooks…" };
    if (!ui.projectorOpen) {
      return { tone: "warn", text: "Projector window closed — press Open projector below" };
    }
    if (ui.manualBlank) return { tone: "warn", text: "Manual blank on · projector forced to black" };
    if (ui.calibrating) return { tone: "ok", text: "Calibrating · drag the 4 pins on the projector" };
    if (ui.show) return { tone: "ok", text: `Showing layout · ${ui.objectCount} object${ui.objectCount === 1 ? "" : "s"}` };
    if (ui.recordingBlank) {
      return {
        tone: "muted",
        text: `Blank · waiting for scene_ready (phase ${ui.phase || "—"}, prompt ${ui.prompt || "—"})`,
      };
    }
    return { tone: "muted", text: "Idle · projector open" };
  }

  function rebuild() {
    if (!root) return;
    const body = root.querySelector(".rp-body");
    if (!body) return;
    body.replaceChildren();

    const status = statusLine();
    body.appendChild(label("Projector state"));
    body.appendChild(
      el("div", { className: `rp-status rp-${status.tone}` }, [
        el("div", { className: "rp-status-main" }, status.text),
        el("div", { className: "rp-muted" }, [
          ui.layoutId ? `layout ${ui.layoutId.slice(0, 8)}` : "no layout yet",
          " · ",
          ui.projectorOpen ? "window open" : "window closed",
        ]),
      ]),
    );

    body.appendChild(label("Window"));
    // Always keep Open projector as the primary recovery action.
    body.appendChild(
      el("div", { className: "rp-grid" }, [
        btn(
          ui.projectorOpen ? "Reopen / focus projector" : "Open projector",
          "Open the black projector window again if you closed it, or bring it to the front",
          () => send({ type: "openProjector" }),
          { tone: "fill", wide: true },
        ),
      ]),
    );
    body.appendChild(
      el("div", { className: "rp-grid-2" }, [
        btn("Fill HDMI display", "Resize the projector window to fill the HDMI screen (Linux: use this instead of F11)", () =>
          send({ type: "fullscreenProjector" }),
        ),
        btn("Refresh state", "Pull the latest /api/state", () => send({ type: "refresh" })),
      ]),
    );
    if (!ui.projectorOpen) {
      body.appendChild(
        el("p", { className: "rp-help" }, [
          "If you closed the projector screen, click ",
          el("strong", {}, "Open projector"),
          " — that recreates it. Drag it onto the HDMI display, then Fill HDMI display.",
        ]),
      );
    }

    body.appendChild(label("Scene"));
    body.appendChild(
      el("div", { className: "rp-grid-2" }, [
        btn(
          ui.calibrating ? "Calibrate · ON" : "Calibrate 4 corners",
          "Show the calibration grid on the projector even without a task",
          () => send({ type: "toggleCalibrate" }),
          { tone: ui.calibrating ? "green" : "outline", active: ui.calibrating },
        ),
        btn(
          ui.manualBlank ? "Manual blank · ON" : "Manual blank",
          "Force the projector to pure black",
          () => send({ type: "toggleManualBlank" }),
          { active: ui.manualBlank },
        ),
        btn(`Flip X · ${ui.flipX ? "ON" : "OFF"}`, "Mirror table +x (right)", () => send({ type: "toggleFlipX" }), {
          active: ui.flipX,
        }),
        btn(`Flip Y · ${ui.flipY ? "ON" : "OFF"}`, "Mirror table +y (toward arms)", () => send({ type: "toggleFlipY" }), {
          active: ui.flipY,
        }),
      ]),
    );

    body.appendChild(
      el(
        "button",
        {
          type: "button",
          className: "rp-link",
          onClick: () => {
            showAdvanced = !showAdvanced;
            rebuild();
          },
        },
        showAdvanced ? "Hide corner fine-tune ▴" : "Show corner fine-tune ▾",
      ),
    );

    if (showAdvanced || ui.calibrating) {
      body.appendChild(label("Corner pins"));
      body.appendChild(
        el(
          "div",
          { className: "rp-grid-4" },
          CORNER_LABELS.map((corner, index) =>
            btn(
              corner.short,
              corner.full,
              () => {
                selectedCorner = index;
                rebuild();
              },
              { active: selectedCorner === index },
            ),
          ),
        ),
      );

      const c = ui.corners[selectedCorner] || { x: 0, y: 0 };
      body.appendChild(
        el("div", { className: "rp-fine" }, [
          el("div", { className: "rp-muted" }, [
            `${CORNER_LABELS[selectedCorner].full} · x=${c.x.toFixed(3)} y=${c.y.toFixed(3)}`,
          ]),
          el("div", { className: "rp-grid-5" }, [
            btn("←", "Nudge left", () => send({ type: "nudgeCorner", index: selectedCorner, dx: -1, dy: 0 })),
            btn("→", "Nudge right", () => send({ type: "nudgeCorner", index: selectedCorner, dx: 1, dy: 0 })),
            btn("↑", "Nudge up", () => send({ type: "nudgeCorner", index: selectedCorner, dx: 0, dy: -1 })),
            btn("↓", "Nudge down", () => send({ type: "nudgeCorner", index: selectedCorner, dx: 0, dy: 1 })),
            btn("Reset", "Restore default corner pins", () => send({ type: "resetCorners" })),
          ]),
          el("div", { className: "rp-grid-2" }, [
            el("label", { className: "rp-field" }, [
              "x",
              el("input", {
                type: "number",
                min: "0",
                max: "1",
                step: "0.001",
                value: String(c.x.toFixed(3)),
                onChange: (event) =>
                  send({
                    type: "setCorner",
                    index: selectedCorner,
                    x: Number(event.target.value),
                    y: c.y,
                  }),
              }),
            ]),
            el("label", { className: "rp-field" }, [
              "y",
              el("input", {
                type: "number",
                min: "0",
                max: "1",
                step: "0.001",
                value: String(c.y.toFixed(3)),
                onChange: (event) =>
                  send({
                    type: "setCorner",
                    index: selectedCorner,
                    x: c.x,
                    y: Number(event.target.value),
                  }),
              }),
            ]),
          ]),
        ]),
      );
    }

    body.appendChild(
      el("p", { className: "rp-help" }, [
        "HY450 digital keystone OFF. Scene footprints appear only during scene_ready. Closed the projector window? Use ",
        el("strong", {}, "Open projector"),
        " anytime.",
      ]),
    );
  }

  function mount() {
    if (document.getElementById("robo-projector-panel")) return;

    const style = el("style", {}, [
      `
#robo-projector-panel {
  position: fixed; right: 12px; bottom: 12px; z-index: 2147483646;
  width: 360px; max-width: calc(100vw - 24px);
  color: #171717; background: #f5f5f3;
  border: 1px solid #d4d4d4;
  box-shadow: 0 10px 28px rgba(0,0,0,.18);
  font: 12.5px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
#robo-projector-panel * { box-sizing: border-box; }
#robo-projector-panel .rp-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 10px; border-bottom: 1px solid #d4d4d4; cursor: move; user-select: none;
  background: #efefed;
}
#robo-projector-panel .rp-title {
  font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  font-size: 11px; color: #525252;
}
#robo-projector-panel .rp-body { padding: 10px; display: grid; gap: 8px; }
#robo-projector-panel.rp-collapsed .rp-body { display: none; }
#robo-projector-panel .rp-label {
  margin: 2px 0 0; font-size: 11px; letter-spacing: 0.08em;
  text-transform: uppercase; color: #737373;
}
#robo-projector-panel .rp-status {
  border: 1px solid #d4d4d4; background: #fff; padding: 8px;
  display: grid; gap: 2px;
}
#robo-projector-panel .rp-status.rp-ok { border-top: 3px solid #3f6b3b; }
#robo-projector-panel .rp-status.rp-warn { border-top: 3px solid #8c1515; }
#robo-projector-panel .rp-status.rp-muted { border-top: 3px solid #d8d8d4; }
#robo-projector-panel .rp-status-main { color: #171717; }
#robo-projector-panel .rp-status.rp-warn .rp-status-main { color: #8c1515; font-weight: 600; }
#robo-projector-panel .rp-muted { color: #737373; font-size: 11px; }
#robo-projector-panel .rp-grid { display: grid; gap: 6px; }
#robo-projector-panel .rp-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#robo-projector-panel .rp-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
#robo-projector-panel .rp-grid-5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
#robo-projector-panel .rp-btn {
  appearance: none; cursor: pointer; border: 1px solid #171717;
  background: #f5f5f3; color: #171717;
  padding: 7px 8px; text-align: left; font: inherit;
}
#robo-projector-panel .rp-btn:hover { background: #efefed; }
#robo-projector-panel .rp-btn.rp-fill {
  background: #171717; color: #efefed; font-weight: 600;
}
#robo-projector-panel .rp-btn.rp-fill:hover { background: #262626; }
#robo-projector-panel .rp-btn.rp-green {
  background: #3f6b3b; border-color: #3f6b3b; color: #efefed; font-weight: 600;
}
#robo-projector-panel .rp-btn.rp-on:not(.rp-fill):not(.rp-green) {
  background: #e5e5e5; box-shadow: inset 0 0 0 1px #171717;
}
#robo-projector-panel .rp-btn.rp-wide { width: 100%; }
#robo-projector-panel .rp-link {
  appearance: none; border: 0; background: transparent; color: #525252;
  text-align: left; padding: 0; cursor: pointer; font: inherit;
  text-decoration: underline; text-underline-offset: 2px;
}
#robo-projector-panel .rp-help { margin: 0; color: #737373; font-size: 11px; }
#robo-projector-panel .rp-field {
  display: flex; align-items: center; gap: 6px; color: #525252;
  border: 1px solid #d4d4d4; background: #fff; padding: 4px 6px;
}
#robo-projector-panel input[type="number"] {
  width: 100%; border: 0; background: transparent; color: #171717; font: inherit;
}
#robo-projector-panel .rp-toggle {
  border: 1px solid #171717; background: #f5f5f3; color: #171717;
  cursor: pointer; font: inherit; padding: 2px 8px;
}
#robo-projector-panel .rp-fine { display: grid; gap: 6px; }
`,
    ]);

    root = el("div", { id: "robo-projector-panel" }, [
      el("div", { className: "rp-head" }, [
        el("div", { className: "rp-title" }, "Table projector"),
        el(
          "button",
          {
            type: "button",
            className: "rp-toggle",
            title: collapsed ? "Expand" : "Collapse",
            onClick: () => {
              collapsed = !collapsed;
              root.classList.toggle("rp-collapsed", collapsed);
            },
          },
          collapsed ? "+" : "—",
        ),
      ]),
      el("div", { className: "rp-body" }),
    ]);

    document.documentElement.appendChild(style);
    document.documentElement.appendChild(root);
    makeDraggable(root, root.querySelector(".rp-head"));
    rebuild();
  }

  function makeDraggable(panel, handle) {
    let ox = 0;
    let oy = 0;
    let dragging = false;
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      ox = event.clientX - rect.left;
      oy = event.clientY - rect.top;
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      panel.style.left = `${Math.max(0, event.clientX - ox)}px`;
      panel.style.top = `${Math.max(0, event.clientY - oy)}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    });
    handle.addEventListener("pointerup", () => {
      dragging = false;
    });
  }

  window.addEventListener("robo-projector-ui", (event) => {
    ui = { ...ui, ...event.detail, connected: true };
    rebuild();
  });

  function boot() {
    mount();
    send({ type: "ping" });
    send({ type: "refresh" });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
