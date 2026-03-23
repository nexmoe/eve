from __future__ import annotations

import json
import sys
from collections.abc import Iterable
from typing import Any


def emit_message(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def emit_error(message: str) -> None:
    emit_message({"type": "error", "payload": {"message": message}})


def iter_requests() -> Iterable[dict[str, Any]]:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            emit_error(f"Invalid JSON request: {exc}")
            continue
        if not isinstance(payload, dict):
            emit_error("Invalid request payload.")
            continue
        yield payload


def ok_response(request_id: str, result: Any) -> dict[str, Any]:
    return {"id": request_id, "ok": True, "result": result}


def error_response(request_id: str, message: str) -> dict[str, Any]:
    return {"id": request_id, "ok": False, "error": message}
