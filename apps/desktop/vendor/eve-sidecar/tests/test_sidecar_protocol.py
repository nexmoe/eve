from __future__ import annotations

import io
import json
import sys
from pathlib import Path

SIDEAR_DIR = Path(__file__).resolve().parents[1]
if str(SIDEAR_DIR) not in sys.path:
    sys.path.insert(0, str(SIDEAR_DIR))

from sidecar_protocol import error_response, iter_requests, ok_response


def test_ok_response_shape() -> None:
    assert ok_response("abc", {"started": True}) == {
        "id": "abc",
        "ok": True,
        "result": {"started": True},
    }


def test_error_response_shape() -> None:
    assert error_response("abc", "boom") == {
        "id": "abc",
        "ok": False,
        "error": "boom",
    }


def test_iter_requests_skips_invalid_json(monkeypatch, capsys) -> None:
    stdin = io.StringIO('{"id":"1","method":"devices.list"}\nnot-json\n')
    monkeypatch.setattr(sys, "stdin", stdin)

    requests = list(iter_requests())

    assert requests == [{"id": "1", "method": "devices.list"}]
    stderr = capsys.readouterr().out.splitlines()
    assert json.loads(stderr[-1]) == {
        "type": "error",
        "payload": {"message": "Invalid JSON request: Expecting value: line 1 column 1 (char 0)"},
    }
