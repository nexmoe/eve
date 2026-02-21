#!/usr/bin/env python3
"""Build native installers for the current platform."""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYPROJECT_FILE = ROOT / "pyproject.toml"
ENTRYPOINT_DIR = ROOT / "packaging" / "entrypoints"


def run(cmd: list[str], cwd: Path | None = None) -> None:
    printable = " ".join(str(part) for part in cmd)
    print(f"+ {printable}")
    env = os.environ.copy()
    if sys.platform == "darwin":
        env["COPYFILE_DISABLE"] = "1"
    subprocess.run(cmd, cwd=cwd or ROOT, check=True, env=env)


def read_version() -> str:
    pyproject = tomllib.loads(PYPROJECT_FILE.read_text(encoding="utf-8"))
    return str(pyproject["project"]["version"])


def detect_target() -> str:
    if sys.platform == "darwin":
        return "macos"
    if sys.platform.startswith("linux"):
        return "linux"
    if sys.platform == "win32":
        return "windows"
    raise RuntimeError(f"Unsupported platform: {sys.platform}")


def detect_arch() -> str:
    machine = platform.machine().lower()
    mapping = {
        "amd64": "x64",
        "x86_64": "x64",
        "arm64": "arm64",
        "aarch64": "arm64",
    }
    return mapping.get(machine, machine)


def detect_deb_arch() -> str:
    machine = platform.machine().lower()
    mapping = {
        "amd64": "amd64",
        "x86_64": "amd64",
        "arm64": "arm64",
        "aarch64": "arm64",
    }
    return mapping.get(machine, machine)


def make_executable(path: Path) -> None:
    if sys.platform == "win32":
        return
    current = path.stat().st_mode
    path.chmod(current | 0o755)


def build_binary(temp_dir: Path) -> Path:
    dist_dir = temp_dir / "dist"
    work_dir = temp_dir / "build"
    spec_dir = temp_dir / "spec"
    dist_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    spec_dir.mkdir(parents=True, exist_ok=True)

    run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onefile",
            "--name",
            "eve",
            "--distpath",
            str(dist_dir),
            "--workpath",
            str(work_dir / "eve"),
            "--specpath",
            str(spec_dir),
            str(ENTRYPOINT_DIR / "eve_cli.py"),
        ]
    )

    suffix = ".exe" if sys.platform == "win32" else ""
    eve_binary = dist_dir / f"eve{suffix}"
    if not eve_binary.exists():
        raise RuntimeError("PyInstaller build did not produce the expected eve binary.")
    return eve_binary


def copy_binary(binary_path: Path, target_path: Path) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(binary_path, target_path)
    make_executable(target_path)

def build_macos_pkg(version: str, arch: str, eve_binary: Path, output_dir: Path, temp_dir: Path) -> Path:
    if shutil.which("pkgbuild") is None:
        raise RuntimeError("pkgbuild is required on macOS to create a .pkg installer.")

    pkg_root = temp_dir / "pkgroot"
    install_bin_dir = pkg_root / "usr" / "local" / "bin"
    copy_binary(eve_binary, install_bin_dir / "eve")
    run(["xattr", "-cr", str(pkg_root)])
    for metadata_file in pkg_root.rglob("._*"):
        metadata_file.unlink(missing_ok=True)

    output_path = output_dir / f"eve-{version}-macos-{arch}.pkg"
    run(
        [
            "pkgbuild",
            "--root",
            str(pkg_root),
            "--identifier",
            "build.nexmoe.eve",
            "--version",
            version,
            "--install-location",
            "/",
            str(output_path),
        ]
    )
    return output_path


def build_linux_deb(version: str, eve_binary: Path, output_dir: Path, temp_dir: Path) -> Path:
    if shutil.which("dpkg-deb") is None:
        raise RuntimeError("dpkg-deb is required on Linux to create a .deb installer.")

    deb_arch = detect_deb_arch()
    deb_root = temp_dir / "debroot"
    control_dir = deb_root / "DEBIAN"
    install_bin_dir = deb_root / "usr" / "local" / "bin"
    control_dir.mkdir(parents=True, exist_ok=True)
    copy_binary(eve_binary, install_bin_dir / "eve")

    control_content = "\n".join(
        [
            "Package: eve",
            f"Version: {version}",
            "Section: utils",
            "Priority: optional",
            f"Architecture: {deb_arch}",
            "Maintainer: eve maintainers",
            "Description: Long-running microphone recorder with optional ASR transcription.",
            "",
        ]
    )
    (control_dir / "control").write_text(control_content, encoding="utf-8")

    output_path = output_dir / f"eve_{version}_{deb_arch}.deb"
    run(["dpkg-deb", "--build", str(deb_root), str(output_path)])
    return output_path


def windows_nsis_script(version: str, output_name: str) -> str:
    return f"""!include "MUI2.nsh"
Name "eve"
OutFile "{output_name}"
InstallDir "$PROGRAMFILES64\\eve"
RequestExecutionLevel admin

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File "app\\eve.exe"
  File /oname=README.md "README.md"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\\eve.exe"
  Delete "$INSTDIR\\README.md"
  Delete "$INSTDIR\\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
"""


def build_windows_installer(version: str, arch: str, eve_binary: Path, output_dir: Path, temp_dir: Path) -> Path:
    if shutil.which("makensis") is None:
        raise RuntimeError(
            "NSIS is required on Windows to create an installer. Install it with 'choco install nsis -y'."
        )

    nsis_root = temp_dir / "nsis"
    app_dir = nsis_root / "app"
    app_dir.mkdir(parents=True, exist_ok=True)
    copy_binary(eve_binary, app_dir / "eve.exe")
    shutil.copy2(ROOT / "README.md", nsis_root / "README.md")

    output_name = f"eve-{version}-windows-{arch}-setup.exe"
    script_path = nsis_root / "installer.nsi"
    script_path.write_text(windows_nsis_script(version=version, output_name=output_name), encoding="utf-8")
    run(["makensis", str(script_path)], cwd=nsis_root)

    output_path = output_dir / output_name
    shutil.copy2(nsis_root / output_name, output_path)
    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a native installer for the current platform.")
    parser.add_argument(
        "--output-dir",
        default="dist/installers",
        help="Output directory for generated installer artifacts (default: dist/installers).",
    )
    parser.add_argument(
        "--version",
        default=None,
        help="Package version override. Defaults to [project].version from pyproject.toml.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    target = detect_target()
    arch = detect_arch()
    version = args.version or read_version()
    output_dir = (ROOT / args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="eve-installer-") as temp_path:
        temp_dir = Path(temp_path)
        eve_binary = build_binary(temp_dir=temp_dir)

        if target == "macos":
            installer = build_macos_pkg(
                version=version,
                arch=arch,
                eve_binary=eve_binary,
                output_dir=output_dir,
                temp_dir=temp_dir,
            )
        elif target == "linux":
            installer = build_linux_deb(
                version=version,
                eve_binary=eve_binary,
                output_dir=output_dir,
                temp_dir=temp_dir,
            )
        elif target == "windows":
            installer = build_windows_installer(
                version=version,
                arch=arch,
                eve_binary=eve_binary,
                output_dir=output_dir,
                temp_dir=temp_dir,
            )
        else:
            raise RuntimeError(f"Unsupported target: {target}")

    print(f"Installer generated: {installer}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
