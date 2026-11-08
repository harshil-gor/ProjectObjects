/**
 * Isolated-world bootstrap: injects injected.js into the real page JS world.
 * Works in Firefox (no reliable MAIN-world content scripts) and Chrome.
 */
(() => {
  if (window.__ROBO_PROJECTOR_INJECTED__) return;
  window.__ROBO_PROJECTOR_INJECTED__ = true;

  const runtime = typeof browser !== "undefined" ? browser.runtime : chrome.runtime;
  const script = document.createElement("script");
  script.src = runtime.getURL("injected.js");
  script.async = false;
  script.onload = () => script.remove();
  script.onerror = () => console.error("[robo-projector] failed to inject page hooks");
  const root = document.documentElement || document.head || document.documentElement;
  (document.documentElement || document.head).appendChild(script);
})();
