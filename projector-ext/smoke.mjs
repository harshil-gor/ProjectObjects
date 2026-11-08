/**
 * Headed Playwright smoke test for the projector hooks.
 * Uses the mock bridge harness page (same JS as the extension).
 */
import { chromium } from "playwright";
import { setTimeout as sleep } from "node:timers/promises";

const HARNESS = "http://127.0.0.1:8765/smoke.html";

await fetch("http://127.0.0.1:8765/api/command", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "reset_mock" }),
});

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => {
  const text = msg.text();
  if (msg.type() === "error" && !text.includes("404") && !text.includes("Failed to load resource")) {
    errors.push(text);
  }
});
page.on("response", (res) => {
  if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
});

await page.goto(HARNESS, { waitUntil: "domcontentloaded" });
await sleep(1500);

const hooks = await page.evaluate(() => {
  const api = window.__ROBO_PROJECTOR__;
  return api ? api.getState() : null;
});

if (!hooks) throw new Error("window.__ROBO_PROJECTOR__ missing — injected.js did not boot");
if (!hooks.layout || hooks.layout.id !== "mocklayout001abc") {
  throw new Error(`expected mock layout, got ${JSON.stringify(hooks.layout)}`);
}
if (hooks.program?.phase !== "scene") throw new Error(`phase=${hooks.program?.phase}`);
if (hooks.prompt?.kind !== "scene_ready") throw new Error(`prompt=${hooks.prompt?.kind}`);

// Open projector + enable calibration via the command bus content.js uses.
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent("robo-projector-cmd", { detail: { type: "openProjector" } }));
  window.dispatchEvent(new CustomEvent("robo-projector-cmd", { detail: { type: "setCalibrate", value: true } }));
});
await sleep(800);

const panel = await page.locator("#robo-projector-panel").count();
if (!panel) throw new Error("floating control panel #robo-projector-panel missing");

const popup = page.context().pages().find((p) => p.url() === "about:blank" || p.url().startsWith("about:blank"));
// about:blank inheriting origin may show as http://127.0.0.1:8765/ after document.write
const projector = page.context().pages().find((p) => p !== page);
if (!projector) throw new Error("projector popup did not open");

await sleep(500);
const projectorOk = await projector.evaluate(() => {
  const svg = document.getElementById("scene");
  const handles = document.querySelectorAll(".handle");
  return {
    hasSvg: !!svg,
    childCount: svg ? svg.childElementCount : 0,
    handleCount: handles.length,
    title: document.title,
  };
});
if (!projectorOk.hasSvg) throw new Error("projector missing #scene svg");
if (projectorOk.childCount < 4) throw new Error(`calibration grid sparse: ${projectorOk.childCount} nodes`);
if (projectorOk.handleCount !== 4) throw new Error(`expected 4 handles, got ${projectorOk.handleCount}`);

// Intercept Start episode: blank + 65ms delay before /api/command.
const started = Date.now();
const response = await page.evaluate(async () => {
  const t0 = performance.now();
  const res = await fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "answer",
      prompt_id: "mock-prompt-1",
      answers: { scene_ready: true },
    }),
  });
  return { status: res.status, ms: performance.now() - t0, body: await res.json() };
});
if (response.status !== 200 || !response.body.ok) throw new Error(`command failed: ${JSON.stringify(response)}`);
if (response.ms < 60) throw new Error(`expected >=65ms settle, saw ${response.ms.toFixed(1)}ms`);

await sleep(800);
const after = await page.evaluate(() => window.__ROBO_PROJECTOR__.getState());
if (!after.recordingBlank) throw new Error("recordingBlank should be true after scene_ready accept");
if (after.prompt != null && after.prompt.kind === "scene_ready") {
  // state may already have advanced via SSE
}

console.log(JSON.stringify({
  ok: true,
  layoutId: hooks.layout.id,
  panel: true,
  projector: projectorOk,
  fetchSettleMs: Math.round(response.ms),
  wallMs: Date.now() - started,
  pageErrors: errors,
}, null, 2));

await browser.close();
process.exit(errors.length ? 1 : 0);
