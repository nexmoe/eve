from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
SRC_DIR = ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from sidecar_protocol import emit_message, error_response, iter_requests, ok_response
from sidecar_runtime import SidecarRuntime


def main() -> int:
    runtime = SidecarRuntime()
    emit_message(
        {
            "type": "ready",
            "payload": {
                "pythonPath": sys.executable,
                "scriptPath": str(Path(__file__).resolve()),
            },
        }
    )
    handlers = {
        "devices.list": lambda _params: runtime.list_devices(),
        "recording.start": lambda _params: runtime.start_recording(),
        "recording.status": lambda _params: runtime.status(),
        "recording.stop": lambda _params: runtime.stop_recording(),
        "settings.apply": lambda params: runtime.apply_settings(params or {}),
        "transcribe.run": lambda params: runtime.run_transcribe(params),
    }
    try:
        for request in iter_requests():
            request_id = str(request.get("id") or "")
            method = str(request.get("method") or "")
            if not request_id:
                emit_message(error_response("unknown", "Request id is required."))
                continue
            handler = handlers.get(method)
            if handler is None:
                emit_message(error_response(request_id, f"Unknown method: {method}"))
                continue
            try:
                result = handler(request.get("params"))
            except Exception as exc:
                emit_message(error_response(request_id, str(exc)))
                continue
            emit_message(ok_response(request_id, result))
    except KeyboardInterrupt:
        pass
    finally:
        runtime.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
