/**
 * Isolated-world floating control bar for the SE3 Robo Projector.
 * Talks to injected.js (MAIN) via window CustomEvents.
 */
(() => {
  if (window.__ROBO_PROJECTOR_UI__) return;
  window.__ROBO_PROJECTOR_UI__ = true;

  const CORNER_LABELS = ["BL 0,0", "BR 1.2,0", "FR 1.2,0.65", "FL 0,0.65"];

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

  function send(detail) {
    window.dispatchEvent(new CustomEvent("robo-projector-cmd", { detail }));
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "style" && typeof value === "object") Object.assign(node.style, value);
      else if (key === "className") node.className = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (value !== false && value != null) node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of [].concat(children)) {
      if (child == null || child === false) continue;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  function btn(label, title, onClick, active = false) {
    return el(
      "button",
      {
        type: "button",
        title,
        className: active ? "rp-btn rp-on" : "rp-btn",
        onClick,
      },
      label,
    );
  }

  function statusText() {
    if (!ui.connected) return "waiting for MAIN hooks…";
    if (ui.manualBlank) return "manual blank";
    if (ui.calibrating) return "calibrating 4 corners";
    if (ui.show) return `scene layout · ${ui.objectCount} objects`;
    if (ui.recordingBlank) return `blank · phase=${ui.phase || "—"} prompt=${ui.prompt || "—"}`;
    return "idle";
  }

  function rebuild() {
    if (!root) return;
    const body = root.querySelector(".rp-body");
    if (!body) return;
    body.replaceChildren();

    body.appendChild(
      el("div", { className: "rp-status" }, [
        el("div", {}, statusText()),
        el("div", { className: "rp-muted" }, [
          `layout ${ui.layoutId ? ui.layoutId.slice(0, 8) : "none"}`,
          ui.projectorOpen ? " · projector open" : " · projector closed",
        ]),
      ]),
    );

    body.appendChild(
      el("div", { className: "rp-row" }, [
        btn(ui.projectorOpen ? "Focus projector" : "Open projector", "Open / focus the HY450 projector popup", () =>
          send({ type: "openProjector" }),
        ),
        btn("Fill HDMI display", "Resize the projector window to fill the HDMI screen (use this instead of F11 on Linux)", () =>
          send({ type: "fullscreenProjector" }),
        ),
        btn("Refresh", "Pull GET /api/state now", () => send({ type: "refresh" })),
      ]),
    );

    body.appendChild(
      el("div", { className: "rp-row" }, [
        btn(
          ui.calibrating ? "Calibrate: ON" : "Calibrate 4 corners",
          "Show calibration grid and drag pins on the projector",
          () => send({ type: "toggleCalibrate" }),
          ui.calibrating,
        ),
        btn(
          ui.manualBlank ? "Manual blank: ON" : "Manual blank",
          "Force projector to #000 regardless of scene state",
          () => send({ type: "toggleManualBlank" }),
          ui.manualBlank,
        ),
      ]),
    );

    body.appendChild(
      el("div", { className: "rp-row" }, [
        btn(`Flip X: ${ui.flipX ? "ON" : "OFF"}`, "Mirror table +x (right)", () => send({ type: "toggleFlipX" }), ui.flipX),
        btn(`Flip Y: ${ui.flipY ? "ON" : "OFF"}`, "Mirror table +y (toward arms)", () => send({ type: "toggleFlipY" }), ui.flipY),
      ]),
    );

    const cornerRow = el("div", { className: "rp-row rp-wrap" });
    CORNER_LABELS.forEach((label, index) => {
      cornerRow.appendChild(
        btn(
          `${index + 1} ${label}`,
          `Select corner ${index + 1} for fine-tune`,
          () => {
            selectedCorner = index;
            rebuild();
          },
          selectedCorner === index,
        ),
      );
    });
    body.appendChild(cornerRow);

    const c = ui.corners[selectedCorner] || { x: 0, y: 0 };
    body.appendChild(
      el("div", { className: "rp-fine" }, [
        el("div", { className: "rp-muted" }, [
          `Corner ${selectedCorner + 1} · x=${c.x.toFixed(3)} y=${c.y.toFixed(3)} (window fractions)`,
        ]),
        el("div", { className: "rp-row" }, [
          btn("←", "Nudge left", () => send({ type: "nudgeCorner", index: selectedCorner, dx: -1, dy: 0 })),
          btn("→", "Nudge right", () => send({ type: "nudgeCorner", index: selectedCorner, dx: 1, dy: 0 })),
          btn("↑", "Nudge up", () => send({ type: "nudgeCorner", index: selectedCorner, dx: 0, dy: -1 })),
          btn("↓", "Nudge down", () => send({ type: "nudgeCorner", index: selectedCorner, dx: 0, dy: 1 })),
          btn("Reset pins", "Restore default corner pins", () => send({ type: "resetCorners" })),
        ]),
        el("div", { className: "rp-row" }, [
          el("label", { className: "rp-field" }, [
            "x ",
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
            "y ",
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

    body.appendChild(
      el("p", { className: "rp-help" }, [
        "Turn OFF HY450 digital keystone. Drag pins on the projector (or fine-tune here) so metre-space footprints land on the physical table. Scene targets show only during scene_ready; Start episode blanks for 65ms before the command reaches the bridge.",
      ]),
    );
  }

  function mount() {
    if (document.getElementById("robo-projector-panel")) return;

    const style = el("style", {}, [
      `
#robo-projector-panel {
  position: fixed; right: 12px; bottom: 12px; z-index: 2147483646;
  width: 340px; max-width: calc(100vw - 24px);
  color: #e7eef0; background: rgba(12, 18, 20, 0.94);
  border: 1px solid #2a4a4e; border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0,0,0,.45);
  font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  backdrop-filter: blur(8px);
}
#robo-projector-panel * { box-sizing: border-box; }
#robo-projector-panel .rp-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 10px; border-bottom: 1px solid #24383b; cursor: move; user-select: none;
}
#robo-projector-panel .rp-title { font-weight: 700; letter-spacing: 0.04em; color: #9effff; }
#robo-projector-panel .rp-body { padding: 8px 10px 10px; display: grid; gap: 8px; }
#robo-projector-panel.rp-collapsed .rp-body { display: none; }
#robo-projector-panel .rp-row { display: flex; flex-wrap: wrap; gap: 6px; }
#robo-projector-panel .rp-wrap { gap: 4px; }
#robo-projector-panel .rp-btn {
  appearance: none; border: 1px solid #3a6066; background: #132226; color: #dffcff;
  border-radius: 6px; padding: 5px 8px; cursor: pointer; font: inherit;
}
#robo-projector-panel .rp-btn:hover { background: #1a3238; }
#robo-projector-panel .rp-btn.rp-on { background: #0d7377; border-color: #14ffec; color: #fff; }
#robo-projector-panel .rp-status { display: grid; gap: 2px; }
#robo-projector-panel .rp-muted { color: #8aa3a8; font-size: 11px; }
#robo-projector-panel .rp-help { margin: 0; color: #8aa3a8; font-size: 11px; }
#robo-projector-panel .rp-field { display: inline-flex; align-items: center; gap: 4px; color: #b7cbd0; }
#robo-projector-panel input[type="number"] {
  width: 72px; background: #0b1518; border: 1px solid #31484c; color: #e7eef0;
  border-radius: 4px; padding: 3px 4px; font: inherit;
}
#robo-projector-panel .rp-toggle {
  border: 0; background: transparent; color: #9effff; cursor: pointer; font: inherit;
}
`,
    ]);

    root = el("div", { id: "robo-projector-panel" }, [
      el("div", { className: "rp-head" }, [
        el("div", { className: "rp-title" }, "SE3 Robo Projector"),
        el(
          "button",
          {
            type: "button",
            className: "rp-toggle",
            title: "Collapse",
            onClick: () => {
              collapsed = !collapsed;
              root.classList.toggle("rp-collapsed", collapsed);
            },
          },
          "—",
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
