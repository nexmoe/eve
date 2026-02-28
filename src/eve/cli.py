from __future__ import annotations

import sys

from eve.utils.cwd_utils import ensure_accessible_cwd


def _ensure_process_cwd() -> None:
    resolved = ensure_accessible_cwd()
    if resolved is not None:
        return
    raise RuntimeError(
        "Current working directory is unavailable and no safe fallback directory "
        "(home or /) could be selected."
    )


def main() -> int | None:
    _ensure_process_cwd()

    if len(sys.argv) > 1 and sys.argv[1] == "transcribe":
        # `eve transcribe --foo` -> transcribe parser gets `--foo`
        sys.argv = [sys.argv[0], *sys.argv[2:]]
        from eve.transcribe_recordings import main as transcribe_main

        return transcribe_main()

    from eve.record_eve_24h import main as record_main

    return record_main()


if __name__ == "__main__":
    raise SystemExit(main())
