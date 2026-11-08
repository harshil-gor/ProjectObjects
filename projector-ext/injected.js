/**
 * MAIN-world hooks for the SE3 console.
 * Attaches before station.ts opens EventSource("/api/events").
 */
(() => {
  if (window.__ROBO_PROJECTOR__) return;

  const STORAGE = {
    corners: "roboProjector.corners",
    flipX: "roboProjector.flipX",
    flipY: "roboProjector.flipY",
    calibrating: "roboProjector.calibrating",
    manualBlank: "roboProjector.manualBlank",
  };

  const DEFAULT_TABLE = [
    [0, 0],
    [1.2, 0],
    [1.2, 0.65],
    [0, 0.65],
  ];

  const COLORS = [
    "#00e5ff", "#ffea00", "#69f0ae", "#ff4081", "#b388ff",
    "#ff9100", "#1de9b6", "#ff5252", "#82b1ff", "#eeeeee",
  ];

  const CORNER_LABELS = [
    "Origin (0,0 Back-Left)",
    "(1.2, 0 Back-Right)",
    "(1.2, 0.65 Front-Right)",
    "(0, 0.65 Front-Left)",
  ];

  /** Default identity pins as fractions of the projector window. */
  const DEFAULT_CORNERS = [
    { x: 0.08, y: 0.12 },
    { x: 0.92, y: 0.12 },
    { x: 0.92, y: 0.88 },
    { x: 0.08, y: 0.88 },
  ];

  const state = {
    layout: null,
    program: null,
    prompt: null,
    recordingBlank: true,
    manualBlank: loadBool(STORAGE.manualBlank, false),
    flipX: loadBool(STORAGE.flipX, false),
    flipY: loadBool(STORAGE.flipY, false),
    calibrating: loadBool(STORAGE.calibrating, false),
    corners: loadCorners(),
    lastLayoutId: null,
    projector: null,
  };

  const OriginalEventSource = window.EventSource;
  const originalFetch = window.fetch.bind(window);

  // ---------------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------------

  function loadBool(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return raw === "1" || raw === "true";
    } catch {
      return fallback;
    }
  }

  function saveBool(key, value) {
    try {
      localStorage.setItem(key, value ? "1" : "0");
    } catch {
      /* ignore quota / private mode */
    }
  }

  function loadCorners() {
    try {
      const raw = localStorage.getItem(STORAGE.corners);
      if (!raw) return DEFAULT_CORNERS.map((c) => ({ ...c }));
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length !== 4) {
        return DEFAULT_CORNERS.map((c) => ({ ...c }));
      }
      return parsed.map((c, i) => ({
        x: clamp01(Number(c.x) || DEFAULT_CORNERS[i].x),
        y: clamp01(Number(c.y) || DEFAULT_CORNERS[i].y),
      }));
    } catch {
      return DEFAULT_CORNERS.map((c) => ({ ...c }));
    }
  }

  function saveCorners() {
    try {
      localStorage.setItem(STORAGE.corners, JSON.stringify(state.corners));
    } catch {
      /* ignore */
    }
  }

  function clamp01(v) {
    return Math.min(1, Math.max(0, v));
  }

  // ---------------------------------------------------------------------------
  // Homography → CSS matrix3d
  // ---------------------------------------------------------------------------

  function solveLinear(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
      }
      [M[col], M[pivot]] = [M[pivot], M[col]];
      const div = M[col][col];
      if (Math.abs(div) < 1e-12) return null;
      for (let c = col; c <= n; c++) M[col][c] /= div;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col];
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    return M.map((row) => row[n]);
  }

  /** Map src[i] → dst[i] (4 points). Returns 3×3 H with H[2][2] = 1. */
  function solveHomography(src, dst) {
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = src[i];
      const { x: u, y: v } = dst[i];
      A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
      b.push(u);
      A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
      b.push(v);
    }
    const h = solveLinear(A, b);
    if (!h) return null;
    return [
      [h[0], h[1], h[2]],
      [h[3], h[4], h[5]],
      [h[6], h[7], 1],
    ];
  }

  function matrix3dCss(H) {
    const [[a, b, c], [d, e, f], [g, h, i]] = H;
    return `matrix3d(${a},${d},0,${g},${b},${e},0,${h},0,0,1,0,${c},${f},0,${i})`;
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers (metre space — never apply camera H)
  // ---------------------------------------------------------------------------

  function tableBounds(layout) {
    const ring = layout?.table?.[0] || DEFAULT_TABLE;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) {
      return { minX: 0, minY: 0, width: 1.2, height: 0.65 };
    }
    return { minX, minY, width: maxX - minX, height: maxY - minY };
  }

  function mapPoint(bounds, [x, y]) {
    let mx = x;
    let my = y;
    if (state.flipX) mx = bounds.minX + bounds.width - (x - bounds.minX);
    if (state.flipY) my = bounds.minY + bounds.height - (y - bounds.minY);
    return [mx, my];
  }

  function outline(rings, bounds) {
    return rings
      .map((ring) =>
        ring
          .map((point, index) => {
            const [x, y] = mapPoint(bounds, point);
            return `${index ? "L" : "M"}${x} ${y}`;
          })
          .join(" ") + " Z",
      )
      .join(" ");
  }

  function descriptionColors(labels) {
    const unique = [...new Set(labels)].sort();
    return new Map(unique.map((label, index) => [label, COLORS[index % COLORS.length]]));
  }

  function shouldShowLayout() {
    return (
      !state.manualBlank &&
      !state.recordingBlank &&
      !!state.layout &&
      state.program?.phase === "scene" &&
      state.prompt?.kind === "scene_ready"
    );
  }

  // ---------------------------------------------------------------------------
  // Projector popup DOM
  // ---------------------------------------------------------------------------

  /** Prefer a non-primary screen (the HDMI projector). Falls back to primary. */
  function projectorScreenRect() {
    const screens = window.screen?.isExtended && window.getScreenDetails
      ? null
      : null;
    // window.screenLeft/Top describe the console monitor; avail* is that screen.
    // Heuristic without Screen Details permission: park far to the right of the
    // current window's screen, which is where Windows usually places HDMI.
    const w = 1920;
    const h = 1080;
    const left = Math.round((window.screen?.availLeft || 0) + (window.screen?.availWidth || 0));
    const top = Math.round(window.screen?.availTop || 0);
    void screens;
    return { left, top, width: w, height: h };
  }

  /** Fill the display the window currently sits on. No F11 / Fullscreen API (flaky on Linux). */
  function fillWindowDisplay(win) {
    try {
      // After you drag the window onto the HDMI output, win.screen is that output.
      const left = win.screen.availLeft ?? win.screenX ?? 0;
      const top = win.screen.availTop ?? win.screenY ?? 0;
      const width = win.screen.availWidth || 1920;
      const height = win.screen.availHeight || 1080;
      win.moveTo(left, top);
      win.resizeTo(width, height);
    } catch (error) {
      console.warn("[robo-projector] fillWindowDisplay failed", error);
    }
  }

  async function placeOnProjectorDisplay(win) {
    try {
      if (typeof win.getScreenDetails === "function") {
        const details = await win.getScreenDetails();
        const screens = details?.screens || [];
        const target =
          screens.find((s) => !s.isPrimary && (s.width === 1920 || s.label?.toLowerCase().includes("proj"))) ||
          screens.find((s) => !s.isPrimary) ||
          screens[0];
        if (target) {
          win.moveTo(target.availLeft, target.availTop);
          win.resizeTo(target.availWidth, target.availHeight);
          return;
        }
      }
    } catch (error) {
      console.warn("[robo-projector] getScreenDetails unavailable", error);
    }
    try {
      // If the window is already on the projector, fill that screen.
      // Otherwise park to the right of the console screen (common HDMI layout).
      const onSecondary =
        (win.screen?.availLeft ?? 0) !== (window.screen?.availLeft ?? 0) ||
        (win.screen?.availTop ?? 0) !== (window.screen?.availTop ?? 0) ||
        (win.screenX || 0) >= (window.screen?.availWidth || 0) - 40;
      if (onSecondary) {
        fillWindowDisplay(win);
      } else {
        const rect = projectorScreenRect();
        win.moveTo(rect.left, rect.top);
        win.resizeTo(rect.width, rect.height);
        // Second pass: once Firefox assigns the window to that screen, fill it.
        setTimeout(() => fillWindowDisplay(win), 50);
        setTimeout(() => fillWindowDisplay(win), 250);
      }
    } catch (error) {
      console.warn("[robo-projector] could not move onto projector display", error);
    }
  }

  function ensureProjector() {
    if (state.projector && !state.projector.closed) {
      void placeOnProjectorDisplay(state.projector);
      return state.projector;
    }
    const rect = projectorScreenRect();
    // Avoid `popup` — Linux/Firefox often cannot keep F11 fullscreen on popup windows.
    const features = `left=${rect.left},top=${rect.top},width=${rect.width},height=${rect.height}`;
    const win = window.open("", "ProjectorView", features);
    if (!win) {
      console.warn("[robo-projector] Popup blocked — allow popups for this origin, then Open Projector.");
      return null;
    }
    state.projector = win;
    const doc = win.document;
    doc.open();
    doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>SE3 Table Projector</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #000; overflow: hidden; cursor: none; }
    html.calibrating, html.calibrating body { cursor: default; }
    #stage { position: absolute; inset: 0; background: #000; }
    #warp {
      position: absolute; left: 0; top: 0; width: 100%; height: 100%;
      transform-origin: 0 0; will-change: transform;
    }
    #scene { width: 100%; height: 100%; display: block; }
    .handle {
      position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px;
      border: 2px solid #fff; background: #ff1744; border-radius: 50%;
      cursor: grab; z-index: 5; box-sizing: border-box;
      font: 700 10px/18px monospace; color: #fff; text-align: center;
      user-select: none; touch-action: none;
    }
    .handle.dragging { cursor: grabbing; }
    #hud {
      position: absolute; left: 8px; top: 8px; z-index: 6;
      font: 12px/1.35 monospace; color: #9effff; background: rgba(0,0,0,.55);
      padding: 6px 8px; border: 1px solid #134e4a; pointer-events: none;
      display: none;
    }
    #fillHint {
      position: absolute; right: 8px; bottom: 8px; z-index: 6;
      font: 12px/1.35 monospace; color: #9effff; background: rgba(0,0,0,.55);
      padding: 6px 8px; border: 1px solid #134e4a; pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="stage">
    <div id="warp"><svg id="scene" xmlns="http://www.w3.org/2000/svg"></svg></div>
    <div id="hud"></div>
    <div id="fillHint">Drag this window onto the HDMI display, then double-click (or press F) to fill — skip F11</div>
  </div>
</body>
</html>`);
    doc.close();

    for (let i = 0; i < 4; i++) {
      const handle = doc.createElement("div");
      handle.className = "handle";
      handle.dataset.corner = String(i);
      handle.textContent = String(i + 1);
      handle.title = CORNER_LABELS[i];
      bindHandleDrag(handle, i);
      doc.getElementById("stage").appendChild(handle);
    }

    const fill = () => {
      fillWindowDisplay(win);
      const hint = win.document.getElementById("fillHint");
      if (hint) hint.style.display = "none";
      renderProjector();
    };
    win.document.getElementById("stage")?.addEventListener("dblclick", fill);
    win.addEventListener("keydown", (event) => {
      if (event.key === "f" || event.key === "F") fill();
    });

    win.addEventListener("resize", () => renderProjector());
    win.addEventListener("beforeunload", () => {
      if (state.projector === win) state.projector = null;
      publishUi();
    });
    // Some browsers close popups without a reliable beforeunload; poll briefly.
    const closeWatch = win.setInterval(() => {
      if (!state.projector || state.projector.closed) {
        win.clearInterval(closeWatch);
        if (state.projector === win || (state.projector && state.projector.closed)) {
          state.projector = null;
          publishUi();
        }
      }
    }, 1000);
    void placeOnProjectorDisplay(win);
    renderProjector();
    return win;
  }

  function bindHandleDrag(handle, index) {
    let dragging = false;
    handle.addEventListener("pointerdown", (event) => {
      if (!state.calibrating) return;
      dragging = true;
      handle.classList.add("dragging");
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!dragging || !state.projector) return;
      const stage = state.projector.document.getElementById("stage");
      const rect = stage.getBoundingClientRect();
      state.corners[index] = {
        x: clamp01((event.clientX - rect.left) / rect.width),
        y: clamp01((event.clientY - rect.top) / rect.height),
      };
      saveCorners();
      renderProjector();
      publishUi();
    });
    const end = (event) => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("dragging");
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function clearProjectorBlack() {
    const win = state.projector;
    if (!win || win.closed) return;
    const svg = win.document.getElementById("scene");
    if (svg) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      svg.style.display = "none";
    }
    const stage = win.document.getElementById("stage");
    if (stage) stage.style.background = "#000000";
    const warp = win.document.getElementById("warp");
    if (warp) warp.style.transform = "none";
    win.document.querySelectorAll(".handle").forEach((el) => {
      el.style.display = "none";
    });
  }

  function applyWarp() {
    const win = state.projector;
    if (!win || win.closed) return;
    const stage = win.document.getElementById("stage");
    const warp = win.document.getElementById("warp");
    if (!stage || !warp) return;
    const W = stage.clientWidth || 1;
    const H = stage.clientHeight || 1;
    const src = [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ];
    const dst = state.corners.map((c) => ({ x: c.x * W, y: c.y * H }));
    const Hm = solveHomography(src, dst);
    warp.style.transform = Hm ? matrix3dCss(Hm) : "none";
  }

  function positionHandles() {
    const win = state.projector;
    if (!win || win.closed) return;
    const stage = win.document.getElementById("stage");
    if (!stage) return;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    win.document.querySelectorAll(".handle").forEach((el) => {
      const i = Number(el.dataset.corner);
      const c = state.corners[i];
      el.style.display = state.calibrating ? "block" : "none";
      el.style.left = `${c.x * W}px`;
      el.style.top = `${c.y * H}px`;
    });
  }

  function svgEl(doc, name, attrs = {}) {
    const el = doc.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }

  function drawCalibrationScene(layout = null) {
    const win = state.projector;
    if (!win || win.closed) return;
    const doc = win.document;
    const svg = doc.getElementById("scene");
    if (!svg) return;

    const bounds = tableBounds(layout);
    const { minX, minY, width, height } = bounds;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.style.display = "block";
    svg.setAttribute("viewBox", `${minX} ${minY} ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const tablePath = outline(layout?.table || [DEFAULT_TABLE], bounds);
    svg.appendChild(svgEl(doc, "path", {
      d: tablePath,
      fill: "none",
      stroke: "#00ffff",
      "stroke-width": 0.012,
      "vector-effect": "non-scaling-stroke",
    }));

    const midX = minX + width / 2;
    const midY = minY + height / 2;
    svg.appendChild(svgEl(doc, "line", {
      x1: midX, y1: minY, x2: midX, y2: minY + height,
      stroke: "#00ffff", "stroke-width": 0.006, "stroke-opacity": 0.7,
      "vector-effect": "non-scaling-stroke",
    }));
    svg.appendChild(svgEl(doc, "line", {
      x1: minX, y1: midY, x2: minX + width, y2: midY,
      stroke: "#00ffff", "stroke-width": 0.006, "stroke-opacity": 0.7,
      "vector-effect": "non-scaling-stroke",
    }));

    for (let x = minX + 0.1; x < minX + width - 1e-6; x += 0.1) {
      svg.appendChild(svgEl(doc, "line", {
        x1: x, y1: minY, x2: x, y2: minY + height,
        stroke: "#00ffff", "stroke-width": 0.002, "stroke-opacity": 0.25,
        "vector-effect": "non-scaling-stroke",
      }));
    }
    for (let y = minY + 0.1; y < minY + height - 1e-6; y += 0.1) {
      svg.appendChild(svgEl(doc, "line", {
        x1: minX, y1: y, x2: minX + width, y2: y,
        stroke: "#00ffff", "stroke-width": 0.002, "stroke-opacity": 0.25,
        "vector-effect": "non-scaling-stroke",
      }));
    }

    const corners = [
      [minX, minY],
      [minX + width, minY],
      [minX + width, minY + height],
      [minX, minY + height],
    ].map((p) => mapPoint(bounds, p));

    corners.forEach(([x, y], i) => {
      svg.appendChild(svgEl(doc, "circle", {
        cx: x, cy: y, r: 0.018, fill: "#ff1744", stroke: "#fff", "stroke-width": 0.004,
      }));
      const label = svgEl(doc, "text", {
        x: x + 0.03, y: y + 0.04,
        fill: "#ffffff", "font-size": 0.045, "font-family": "monospace",
      });
      label.textContent = CORNER_LABELS[i];
      svg.appendChild(label);
    });
  }

  function drawLayoutScene(layout) {
    const win = state.projector;
    if (!win || win.closed) return;
    const doc = win.document;
    const svg = doc.getElementById("scene");
    if (!svg) return;

    const bounds = tableBounds(layout);
    const { minX, minY, width, height } = bounds;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.style.display = "block";
    svg.setAttribute("viewBox", `${minX} ${minY} ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "none");

    svg.appendChild(svgEl(doc, "path", {
      d: outline(layout.table, bounds),
      fill: "none",
      stroke: "#00ffff",
      "stroke-width": 0.01,
      "vector-effect": "non-scaling-stroke",
    }));

    const colors = descriptionColors(layout.objects.map((o) => o.label));
    for (const obj of layout.objects) {
      const color = colors.get(obj.label) || COLORS[0];
      svg.appendChild(svgEl(doc, "path", {
        d: outline(obj.rings, bounds),
        fill: color,
        "fill-opacity": 0.22,
        "fill-rule": "evenodd",
        stroke: color,
        "stroke-width": 0.008,
        "vector-effect": "non-scaling-stroke",
      }));

      const [cx, cy] = mapPoint(bounds, obj.center);
      const [dx, dy] = mapPoint(bounds, obj.direction);
      const arm = 0.025;
      svg.appendChild(svgEl(doc, "path", {
        d: `M${cx - arm} ${cy} h${arm * 2} M${cx} ${cy - arm} v${arm * 2}`,
        stroke: color, "stroke-width": 0.006, fill: "none",
        "vector-effect": "non-scaling-stroke",
      }));

      const markerId = `arrow-${obj.id}`;
      const defs = svgEl(doc, "defs");
      const marker = svgEl(doc, "marker", {
        id: markerId, markerWidth: 7, markerHeight: 7, refX: 6, refY: 3.5,
        orient: "auto", markerUnits: "strokeWidth",
      });
      marker.appendChild(svgEl(doc, "path", {
        d: "M0 0 L7 3.5 L0 7", fill: "none", stroke: color, "stroke-width": 1,
      }));
      defs.appendChild(marker);
      svg.appendChild(defs);
      svg.appendChild(svgEl(doc, "path", {
        d: `M${cx} ${cy} L${dx} ${dy}`,
        stroke: color, "stroke-width": 0.006, fill: "none",
        "marker-end": `url(#${markerId})`,
        "vector-effect": "non-scaling-stroke",
      }));

      const label = svgEl(doc, "text", {
        x: cx + 0.02, y: cy - 0.02,
        fill: "#ffffff", "font-size": 0.04, "font-family": "monospace",
        "paint-order": "stroke", stroke: "#000", "stroke-width": 0.01,
      });
      label.textContent = obj.label || obj.id;
      svg.appendChild(label);
    }
  }

  function renderProjector() {
    const win = ensureProjector();
    if (!win) {
      publishUi();
      return;
    }

    const show = shouldShowLayout();
    const hud = win.document.getElementById("hud");

    win.document.documentElement.classList.toggle("calibrating", state.calibrating);

    if (state.calibrating) {
      drawCalibrationScene(state.layout);
      if (hud) {
        hud.style.display = "block";
        hud.textContent = "CALIBRATING · drag red pins to physical table corners · digital keystone OFF";
      }
    } else if (show) {
      drawLayoutScene(state.layout);
      if (hud) hud.style.display = "none";
    } else {
      clearProjectorBlack();
      if (hud) {
        hud.style.display = "block";
        hud.textContent = state.manualBlank
          ? "MANUAL BLANK"
          : state.recordingBlank
            ? "BLANK · recording / not in scene_ready"
            : "BLANK · waiting for scene layout";
      }
      positionHandles();
      publishUi();
      return;
    }

    applyWarp();
    positionHandles();
    publishUi();
  }

  // ---------------------------------------------------------------------------
  // Station state lifecycle
  // ---------------------------------------------------------------------------

  function applyStationState(payload) {
    if (!payload || payload.type !== "state") return;

    const prevId = state.lastLayoutId;
    state.layout = payload.layout ?? null;
    state.program = payload.program ?? null;
    state.prompt = payload.prompt ?? null;

    const phase = state.program?.phase;
    const promptKind = state.prompt?.kind;
    const inSceneReady = phase === "scene" && promptKind === "scene_ready";

    if (state.layout?.id && state.layout.id !== prevId && phase === "scene") {
      state.recordingBlank = false;
    }
    state.lastLayoutId = state.layout?.id ?? null;

    if (!inSceneReady) {
      state.recordingBlank = true;
    }

    renderProjector();
  }

  async function pullSnapshot() {
    try {
      const response = await originalFetch("/api/state", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json();
      applyStationState({ type: "state", ...body });
    } catch (error) {
      console.warn("[robo-projector] /api/state snapshot failed", error);
    }
  }

  function blankForRecording() {
    state.recordingBlank = true;
    // Synchronous DOM clear before the 65 ms settle.
    if (state.projector && !state.projector.closed) {
      const doc = state.projector.document;
      const svg = doc.getElementById("scene");
      if (svg) {
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        svg.style.display = "none";
      }
      const stage = doc.getElementById("stage");
      if (stage) stage.style.background = "#000000";
      const warp = doc.getElementById("warp");
      if (warp) warp.style.transform = "none";
      const hud = doc.getElementById("hud");
      if (hud) {
        hud.style.display = "block";
        hud.textContent = "BLANK · scene_ready accepted · settling 65ms";
      }
      doc.querySelectorAll(".handle").forEach((el) => {
        el.style.display = "none";
      });
    }
    publishUi();
  }

  // ---------------------------------------------------------------------------
  // EventSource + fetch wraps (document_start)
  // ---------------------------------------------------------------------------

  function wrapEventSource() {
    function WrappedEventSource(url, config) {
      const source = new OriginalEventSource(url, config);
      const href = String(url);
      if (href.includes("/api/events")) {
        source.addEventListener("message", (event) => {
          try {
            applyStationState(JSON.parse(event.data));
          } catch (error) {
            console.warn("[robo-projector] bad SSE payload", error);
          }
        });
      }
      return source;
    }
    WrappedEventSource.prototype = OriginalEventSource.prototype;
    Object.keys(OriginalEventSource).forEach((key) => {
      try {
        WrappedEventSource[key] = OriginalEventSource[key];
      } catch {
        /* read-only */
      }
    });
    WrappedEventSource.CONNECTING = OriginalEventSource.CONNECTING;
    WrappedEventSource.OPEN = OriginalEventSource.OPEN;
    WrappedEventSource.CLOSED = OriginalEventSource.CLOSED;
    window.EventSource = WrappedEventSource;
  }

  function wrapFetch() {
    window.fetch = async function roboProjectorFetch(input, init) {
      const url = typeof input === "string" ? input : input?.url || "";
      const method = (init?.method || (typeof input !== "string" && input?.method) || "GET").toUpperCase();

      if (url.includes("/api/command") && method === "POST") {
        let bodyText = init?.body;
        if (bodyText == null && typeof input !== "string" && input?.clone) {
          try {
            bodyText = await input.clone().text();
          } catch {
            bodyText = null;
          }
        }
        if (typeof bodyText === "string") {
          try {
            const body = JSON.parse(bodyText);
            if (body?.action === "answer" && body?.answers?.scene_ready === true) {
              blankForRecording();
              await new Promise((resolve) => setTimeout(resolve, 65));
            }
          } catch {
            /* not JSON — pass through */
          }
        }
      }
      return originalFetch(input, init);
    };
  }

  // ---------------------------------------------------------------------------
  // UI bridge (CustomEvents ↔ isolated content.js)
  // ---------------------------------------------------------------------------

  function publishUi() {
    window.dispatchEvent(
      new CustomEvent("robo-projector-ui", {
        detail: {
          connected: true,
          show: shouldShowLayout(),
          recordingBlank: state.recordingBlank,
          manualBlank: state.manualBlank,
          calibrating: state.calibrating,
          flipX: state.flipX,
          flipY: state.flipY,
          corners: state.corners.map((c) => ({ ...c })),
          phase: state.program?.phase ?? null,
          prompt: state.prompt?.kind ?? null,
          layoutId: state.layout?.id ?? null,
          objectCount: state.layout?.objects?.length ?? 0,
          projectorOpen: !!(state.projector && !state.projector.closed),
        },
      }),
    );
  }

  function onCommand(event) {
    const cmd = event.detail || {};
    switch (cmd.type) {
      case "openProjector":
        // If the operator closed the projector window, recreate it; otherwise focus/fill.
        if (state.projector && state.projector.closed) state.projector = null;
        ensureProjector();
        if (state.projector && !state.projector.closed) {
          try { state.projector.focus(); } catch { /* ignore */ }
        }
        renderProjector();
        break;
      case "fullscreenProjector":
        ensureProjector();
        if (state.projector && !state.projector.closed) {
          // Prefer borderless-style fill via resize; do not call requestFullscreen (breaks on Linux).
          fillWindowDisplay(state.projector);
          void placeOnProjectorDisplay(state.projector);
          const hint = state.projector.document.getElementById("fillHint");
          if (hint) hint.style.display = "none";
        }
        renderProjector();
        break;
      case "toggleCalibrate":
        state.calibrating = !state.calibrating;
        saveBool(STORAGE.calibrating, state.calibrating);
        renderProjector();
        break;
      case "setCalibrate":
        state.calibrating = !!cmd.value;
        saveBool(STORAGE.calibrating, state.calibrating);
        renderProjector();
        break;
      case "toggleFlipX":
        state.flipX = !state.flipX;
        saveBool(STORAGE.flipX, state.flipX);
        renderProjector();
        break;
      case "toggleFlipY":
        state.flipY = !state.flipY;
        saveBool(STORAGE.flipY, state.flipY);
        renderProjector();
        break;
      case "toggleManualBlank":
        state.manualBlank = !state.manualBlank;
        saveBool(STORAGE.manualBlank, state.manualBlank);
        renderProjector();
        break;
      case "setCorner": {
        const i = Number(cmd.index);
        if (i >= 0 && i < 4) {
          state.corners[i] = {
            x: clamp01(Number(cmd.x)),
            y: clamp01(Number(cmd.y)),
          };
          saveCorners();
          renderProjector();
        }
        break;
      }
      case "nudgeCorner": {
        const i = Number(cmd.index);
        if (i >= 0 && i < 4) {
          const step = Number(cmd.step) || 0.005;
          state.corners[i] = {
            x: clamp01(state.corners[i].x + (Number(cmd.dx) || 0) * step),
            y: clamp01(state.corners[i].y + (Number(cmd.dy) || 0) * step),
          };
          saveCorners();
          renderProjector();
        }
        break;
      }
      case "resetCorners":
        state.corners = DEFAULT_CORNERS.map((c) => ({ ...c }));
        saveCorners();
        renderProjector();
        break;
      case "refresh":
        pullSnapshot();
        break;
      case "ping":
        publishUi();
        break;
      default:
        break;
    }
  }

  window.addEventListener("robo-projector-cmd", onCommand);

  wrapEventSource();
  wrapFetch();

  window.__ROBO_PROJECTOR__ = {
    version: "1.0.0",
    getState: () => ({
      layout: state.layout,
      program: state.program,
      prompt: state.prompt,
      recordingBlank: state.recordingBlank,
      manualBlank: state.manualBlank,
      calibrating: state.calibrating,
      flipX: state.flipX,
      flipY: state.flipY,
      corners: state.corners,
    }),
  };

  // Snapshot after the page can talk to the bridge (token cookie already set).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      pullSnapshot();
      publishUi();
    });
  } else {
    pullSnapshot();
    publishUi();
  }

  console.info("[robo-projector] MAIN hooks armed (EventSource + fetch)");
})();
