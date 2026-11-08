"""Minimal SE3 console bridge stub for local extension smoke tests.

Serves /api/state, /api/events (SSE), /api/command, /api/health on :8765
with a scene_ready teleop state and a sample LayoutScene in table metres.
"""

from __future__ import annotations

import json
import queue
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 8765

LAYOUT = {
    "id": "mocklayout001abc",
    "camera": "topdown",
    "view": 0,
    "seed": 42,
    "width": 640,
    "height": 480,
    "homography": [[400.0, 0.0, 40.0], [0.0, 400.0, 30.0], [0.0, 0.0, 1.0]],
    "table": [[[0.0, 0.0], [1.2, 0.0], [1.2, 0.65], [0.0, 0.65], [0.0, 0.0]]],
    "objects": [
        {
            "id": "cup",
            "label": "Blue cup",
            "instruction": "Upright near the center",
            "rings": [[[0.45, 0.25], [0.60, 0.25], [0.60, 0.40], [0.45, 0.40], [0.45, 0.25]]],
            "center": [0.525, 0.325],
            "direction": [0.575, 0.325],
        },
        {
            "id": "block",
            "label": "Red block",
            "instruction": "Flat on the table",
            "rings": [
                [[0.15, 0.10], [0.30, 0.10], [0.30, 0.25], [0.15, 0.25], [0.15, 0.10]],
                [[0.18, 0.13], [0.27, 0.13], [0.27, 0.22], [0.18, 0.22], [0.18, 0.13]],
            ],
            "center": [0.225, 0.175],
            "direction": [0.275, 0.175],
        },
    ],
}


def make_state(*, phase: str = "scene", prompt: bool = True, layout: bool = True, rev: int = 1) -> dict:
    return {
        "rev": rev,
        "station": {
            "id": "mock-station",
            "version": "mock",
            "leader": True,
            "layout": "Mock",
            "base": "table",
            "backend": "fake",
            "loop_hz": 50.0,
            "arms": {},
            "cameras": {
                "topdown": {
                    "device_type": "mock",
                    "height": 480,
                    "width": 640,
                    "refresh_rate": 30,
                    "n_views": 1,
                    "jpeg_compression": 65,
                }
            },
            "urls": [],
            "login": {"name": "local-test", "email": None},
            "read_only": False,
            "record": True,
        },
        "online": True,
        "control": {
            "authority": "se3_manual",
            "layer": "hold",
            "hold_reason": None,
            "leased": True,
            "paused": False,
            "stopped": False,
            "released_arm": None,
            "aligning": False,
            "resumes": False,
            "emergency": {},
        },
        "tasks": [{"id": "ROBODOJO-REAL-03", "name": "Mock task", "modes": ["teleop"],
                   "reset_instruction": "Place objects", "instruction": "Pick up"}],
        "selection": {"task_id": "ROBODOJO-REAL-03", "mode": "teleop", "operator": "tester", "episodes": 1},
        "relay": "",
        "program": {
            "kind": "teleop",
            "task_id": "ROBODOJO-REAL-03",
            "phase": phase,
            "job_id": "mock-job",
            "task": {
                "name": "ROBODOJO-REAL-03",
                "description": "Mock episode for projector testing",
                "reset_instruction": "Place the blue cup and red block as shown",
                "instruction": "Pick up the cup",
            },
            "episode": {"id": "ep_0001", "index": 1, "requested": 1},
            "phase_started_at": time.time(),
        },
        "prompt": {
            "id": "mock-prompt-1",
            "kind": "scene_ready",
            "items": [{
                "key": "scene_ready",
                "prompt": "Is the scene ready? Yes starts the episode; No cancels the job.",
                "kind": "binary",
                "weight": None,
                "choices": [],
            }],
        } if prompt else None,
        "calibration": {"arm": None, "camera": None},
        "layout": LAYOUT if layout else None,
        "actions": ["answer", "cancel", "home", "end", "pause", "resume"],
    }


class Hub:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.clients: list[queue.Queue[str]] = []
        self.rev = 1
        self.state = make_state(rev=self.rev)

    def snapshot(self) -> dict:
        with self.lock:
            return {"type": "state", "ts": time.time(), **self.state}

    def publish(self, state: dict) -> None:
        with self.lock:
            self.rev += 1
            state = {**state, "rev": self.rev}
            self.state = state
            line = json.dumps({"type": "state", "ts": time.time(), **state}, separators=(",", ":"))
            for q in list(self.clients):
                if q.qsize() < 100:
                    q.put(line)

    def subscribe(self) -> queue.Queue[str]:
        q: queue.Queue[str] = queue.Queue()
        with self.lock:
            q.put(json.dumps(self.snapshot(), separators=(",", ":")))
            self.clients.append(q)
        return q

    def unsubscribe(self, q: queue.Queue[str]) -> None:
        with self.lock:
            if q in self.clients:
                self.clients.remove(q)


HUB = Hub()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        print(f"[mock-bridge] {self.command} {self.path} -> {format % args}")

    def _json(self, code: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path in ("/", "/smoke.html"):
            here = Path(__file__).resolve().parent
            html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Projector smoke harness</title></head>
<body style="font:14px monospace;background:#111;color:#eee;padding:16px">
  <h1>SE3 Robo Projector smoke harness</h1>
  <p>Loads injected.js + content.js as page scripts (same logic as the extension MAIN/isolated split).</p>
  <pre id="log"></pre>
  <script src="/injected.js"></script>
  <script src="/content.js"></script>
  <script>
    const log = (m) => {{ document.getElementById('log').textContent += m + '\\n'; console.log(m); }};
    const es = new EventSource('/api/events');
    es.onopen = () => log('EventSource open');
    es.onmessage = (e) => {{
      const msg = JSON.parse(e.data);
      if (msg.type === 'state') log('state phase=' + (msg.program && msg.program.phase) + ' layout=' + (msg.layout && msg.layout.id) + ' hooks=' + !!window.__ROBO_PROJECTOR__);
    }};
  </script>
</body></html>"""
            data = html.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if path in ("/injected.js", "/content.js"):
            here = Path(__file__).resolve().parent
            target = here / path.lstrip("/")
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if path == "/api/health":
            return self._json(200, {"ok": True, "version": "mock", "station_id": "mock-station"})
        if path == "/api/state":
            snap = HUB.snapshot()
            body = {k: v for k, v in snap.items() if k not in ("type", "ts")}
            return self._json(200, body)
        if path == "/api/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            q = HUB.subscribe()
            try:
                self.wfile.write(b"retry: 2000\n\n")
                self.wfile.flush()
                while True:
                    try:
                        line = q.get(timeout=15)
                        self.wfile.write(f"data: {line}\n\n".encode())
                        self.wfile.flush()
                    except queue.Empty:
                        self.wfile.write(b": keep-alive\n\n")
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
            finally:
                HUB.unsubscribe(q)
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return self._json(400, {"error": "invalid json"})

        if path != "/api/command":
            return self._json(404, {"error": "not found"})

        action = body.get("action")
        answers = body.get("answers") or {}
        print(f"[mock-bridge] command action={action!r} answers={answers!r}")

        if action == "reset_mock":
            HUB.publish(make_state(phase="scene", prompt=True, layout=True))
            return self._json(200, {"ok": True})

        if action == "answer" and answers.get("scene_ready") is True:
            # Mimic leaving scene_ready after Start episode.
            time.sleep(0.02)
            HUB.publish(make_state(phase="start_walk", prompt=False, layout=True))
            return self._json(200, {"ok": True})

        if action == "answer" and answers.get("scene_ready") is False:
            HUB.publish(make_state(phase="aborted", prompt=False, layout=False))
            return self._json(200, {"ok": True})

        return self._json(200, {"ok": True})


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[mock-bridge] listening on http://127.0.0.1:{PORT}")
    print("[mock-bridge] state: teleop phase=scene prompt=scene_ready with sample layout")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[mock-bridge] stopped")


if __name__ == "__main__":
    main()
