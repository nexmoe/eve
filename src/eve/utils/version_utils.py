from __future__ import annotations

from importlib import metadata
from pathlib import Path
import tomllib

PACKAGE_NAME = "eve"


def _version_from_installed_package() -> str | None:
    try:
        return metadata.version(PACKAGE_NAME)
    except metadata.PackageNotFoundError:
        return None
    except Exception:
        return None


def _version_from_pyproject() -> str | None:
    try:
        project_root = Path(__file__).resolve().parents[3]
        pyproject_path = project_root / "pyproject.toml"
        if not pyproject_path.exists():
            return None
        data = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
        version = data.get("project", {}).get("version")
        if isinstance(version, str) and version.strip():
            return version.strip()
    except Exception:
        return None
    return None


def get_eve_version() -> str:
    return _version_from_installed_package() or _version_from_pyproject() or "unknown"
