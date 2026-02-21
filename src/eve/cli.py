from __future__ import annotations

import sys

from eve.record_eve_24h import main as record_main
from eve.transcribe_recordings import main as transcribe_main


def main() -> int | None:
    if len(sys.argv) > 1 and sys.argv[1] == "transcribe":
        # `eve transcribe --foo` -> transcribe parser gets `--foo`
        sys.argv = [sys.argv[0], *sys.argv[2:]]
        return transcribe_main()
    return record_main()


if __name__ == "__main__":
    raise SystemExit(main())
