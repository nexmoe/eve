from __future__ import annotations

import os


def ensure_accessible_cwd() -> str | None:
    """Return an accessible cwd, switching to a safe fallback when needed."""
    try:
        return os.getcwd()
    except FileNotFoundError:
        pass

    candidates: list[str] = []
    home = os.path.expanduser("~")
    if home:
        candidates.append(home)
    candidates.append("/")

    for candidate in candidates:
        try:
            os.chdir(candidate)
            return os.getcwd()
        except Exception:
            continue

    return None
