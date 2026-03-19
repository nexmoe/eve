#!/usr/bin/env python3
"""Build native installers for the current platform."""

from __future__ import annotations

import argparse
import importlib.util
import os
import platform
import plistlib
import shutil
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path

try:
    from installer_support import (
        MACOS_MICROPHONE_USAGE_DESCRIPTION,
        windows_nsis_script,
        write_unix_launcher,
    )
except ModuleNotFoundError:
    from scripts.installer_support import (
        MACOS_MICROPHONE_USAGE_DESCRIPTION,
        windows_nsis_script,
        write_unix_launcher,
    )

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


def resolve_package_dir(package_name: str) -> Path | None:
    spec = importlib.util.find_spec(package_name)
    if spec is None or not spec.submodule_search_locations:
        return None
    return Path(next(iter(spec.submodule_search_locations))).resolve()


def common_pyinstaller_args(dist_dir: Path, work_dir: Path, spec_dir: Path) -> list[str]:
    return [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--distpath",
        str(dist_dir),
        "--workpath",
        str(work_dir),
        "--specpath",
        str(spec_dir),
        "--copy-metadata",
        "eve",
    ]


def add_common_hidden_imports(pyinstaller_cmd: list[str]) -> None:
    # nagisa uses absolute imports like `import prepro` and mutates sys.path at runtime.
    # Add its package directory to PyInstaller's module search path and include those modules explicitly.
    nagisa_dir = resolve_package_dir("nagisa")
    if nagisa_dir is not None:
        pyinstaller_cmd.extend(["--paths", str(nagisa_dir)])
    pyinstaller_cmd.extend(
        [
            "--hidden-import",
            "prepro",
            "--hidden-import",
            "model",
            "--hidden-import",
            "mecab_system_eval",
            "--hidden-import",
            "tagger",
            "--hidden-import",
            "train",
            "--hidden-import",
            "AVFoundation",
            "--hidden-import",
            "CoreAudio",
            "--hidden-import",
            "CoreMedia",
            "--hidden-import",
            "silero_vad.data",
            "--collect-submodules",
            "flet",
            "--collect-submodules",
            "pystray",
            "--collect-submodules",
            "PIL",
            # Rich loads unicode tables via dynamic module names like
            # `rich._unicode_data.unicode17-0-0`, which static analysis misses.
            "--collect-submodules",
            "rich._unicode_data",
            "--collect-data",
            "flet",
            "--collect-data",
            "nagisa",
            "--collect-data",
            "PIL",
            "--collect-data",
            "pystray",
            "--collect-data",
            "qwen_asr",
            "--collect-data",
            "silero_vad",
        ]
    )


def build_binary(temp_dir: Path) -> tuple[Path, Path]:
    dist_dir = temp_dir / "dist"
    work_dir = temp_dir / "build"
    spec_dir = temp_dir / "spec"
    dist_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    spec_dir.mkdir(parents=True, exist_ok=True)

    pyinstaller_cmd = common_pyinstaller_args(
        dist_dir=dist_dir,
        work_dir=work_dir / "eve-cli",
        spec_dir=spec_dir,
    )
    pyinstaller_cmd.extend(
        [
        "--onedir",
        "--name",
        "eve",
        ]
    )
    add_common_hidden_imports(pyinstaller_cmd)
    pyinstaller_cmd.append(str(ENTRYPOINT_DIR / "eve_cli.py"))

    run(pyinstaller_cmd)

    app_dir = dist_dir / "eve"
    suffix = ".exe" if sys.platform == "win32" else ""
    eve_binary = app_dir / f"eve{suffix}"
    if not eve_binary.exists():
        raise RuntimeError("PyInstaller build did not produce the expected eve binary.")
    return eve_binary, app_dir


def build_macos_desktop_app(temp_dir: Path, version: str) -> Path:
    dist_dir = temp_dir / "dist"
    work_dir = temp_dir / "build"
    spec_dir = temp_dir / "spec"
    dist_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    spec_dir.mkdir(parents=True, exist_ok=True)

    pyinstaller_cmd = common_pyinstaller_args(
        dist_dir=dist_dir,
        work_dir=work_dir / "eve-desktop",
        spec_dir=spec_dir,
    )
    pyinstaller_cmd.extend(
        [
            "--windowed",
            "--name",
            "eve",
            "--osx-bundle-identifier",
            "build.nexmoe.eve",
        ]
    )
    add_common_hidden_imports(pyinstaller_cmd)
    pyinstaller_cmd.append(str(ENTRYPOINT_DIR / "eve_desktop.py"))

    run(pyinstaller_cmd)

    app_bundle = dist_dir / "eve.app"
    if not app_bundle.exists():
        raise RuntimeError("PyInstaller build did not produce the expected eve.app bundle.")
    set_macos_bundle_version(app_bundle, version)
    return app_bundle


def copy_binary(binary_path: Path, target_path: Path) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(binary_path, target_path)
    make_executable(target_path)

def copy_bundle(source_dir: Path, target_dir: Path) -> None:
    if target_dir.exists():
        shutil.rmtree(target_dir)
    shutil.copytree(source_dir, target_dir, symlinks=True)


def clean_pkg_source(path: Path) -> None:
    run(["xattr", "-cr", str(path)])
    for metadata_file in path.rglob("._*"):
        metadata_file.unlink(missing_ok=True)


def set_macos_bundle_version(app_bundle: Path, version: str) -> None:
    info_plist = app_bundle / "Contents" / "Info.plist"
    if not info_plist.exists():
        raise RuntimeError(f"Missing Info.plist in app bundle: {app_bundle}")

    with info_plist.open("rb") as handle:
        payload = plistlib.load(handle)

    payload["CFBundleShortVersionString"] = version
    payload["CFBundleVersion"] = version
    payload["NSMicrophoneUsageDescription"] = MACOS_MICROPHONE_USAGE_DESCRIPTION

    with info_plist.open("wb") as handle:
        plistlib.dump(payload, handle)


def write_macos_component_plist(root_dir: Path, bundle_path: str, output_path: Path) -> Path:
    run(["pkgbuild", "--analyze", "--root", str(root_dir), str(output_path)])
    with output_path.open("rb") as handle:
        payload = plistlib.load(handle)

    for component in payload:
        if component.get("RootRelativeBundlePath") != bundle_path:
            continue
        component["BundleIsRelocatable"] = False
        component["BundleHasStrictIdentifier"] = True
        with output_path.open("wb") as handle:
            plistlib.dump(payload, handle)
        return output_path

    raise RuntimeError(f"Bundle {bundle_path} not found in component plist for {root_dir}")


def write_macos_product_requirements(output_path: Path) -> Path:
    with output_path.open("wb") as handle:
        plistlib.dump({"home": False}, handle)
    return output_path


def build_macos_pkg(
    version: str,
    arch: str,
    eve_app_dir: Path,
    eve_desktop_app: Path,
    output_dir: Path,
    temp_dir: Path,
) -> Path:
    if shutil.which("pkgbuild") is None or shutil.which("productbuild") is None:
        raise RuntimeError("pkgbuild and productbuild are required on macOS to create a .pkg installer.")

    packages_dir = temp_dir / "packages"
    packages_dir.mkdir(parents=True, exist_ok=True)

    cli_root = temp_dir / "pkgroot-cli"
    install_bin_dir = cli_root / "usr" / "local" / "bin"
    install_lib_dir = cli_root / "usr" / "local" / "lib" / "eve"
    copy_bundle(eve_app_dir, install_lib_dir)
    write_unix_launcher(install_bin_dir / "eve", "/usr/local/lib/eve/eve")
    clean_pkg_source(cli_root)

    desktop_root = temp_dir / "pkgroot-desktop"
    desktop_bundle_path = desktop_root / "Applications" / "eve.app"
    copy_bundle(eve_desktop_app, desktop_bundle_path)
    clean_pkg_source(desktop_root)
    desktop_component_plist = write_macos_component_plist(
        root_dir=desktop_root,
        bundle_path="Applications/eve.app",
        output_path=temp_dir / "desktop-components.plist",
    )
    product_requirements = write_macos_product_requirements(
        temp_dir / "product-requirements.plist"
    )

    cli_pkg = packages_dir / "eve-cli.pkg"
    run(
        [
            "pkgbuild",
            "--root",
            str(cli_root),
            "--identifier",
            "build.nexmoe.eve.cli",
            "--version",
            version,
            "--install-location",
            "/",
            str(cli_pkg),
        ]
    )

    desktop_pkg = packages_dir / "eve-desktop.pkg"
    run(
        [
            "pkgbuild",
            "--root",
            str(desktop_root),
            "--component-plist",
            str(desktop_component_plist),
            "--identifier",
            "build.nexmoe.eve.desktop",
            "--version",
            version,
            "--install-location",
            "/",
            str(desktop_pkg),
        ]
    )

    output_path = output_dir / f"eve-{version}-macos-{arch}.pkg"
    run(
        [
            "productbuild",
            "--product",
            str(product_requirements),
            "--identifier",
            "build.nexmoe.eve",
            "--version",
            version,
            "--package",
            str(cli_pkg),
            "--package",
            str(desktop_pkg),
            str(output_path),
        ]
    )
    return output_path


def build_linux_deb(version: str, eve_app_dir: Path, output_dir: Path, temp_dir: Path) -> Path:
    if shutil.which("dpkg-deb") is None:
        raise RuntimeError("dpkg-deb is required on Linux to create a .deb installer.")

    deb_arch = detect_deb_arch()
    deb_root = temp_dir / "debroot"
    control_dir = deb_root / "DEBIAN"
    install_bin_dir = deb_root / "usr" / "local" / "bin"
    install_lib_dir = deb_root / "usr" / "local" / "lib" / "eve"
    control_dir.mkdir(parents=True, exist_ok=True)
    copy_bundle(eve_app_dir, install_lib_dir)
    write_unix_launcher(install_bin_dir / "eve", "/usr/local/lib/eve/eve")

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


def build_windows_installer(version: str, arch: str, eve_app_dir: Path, output_dir: Path, temp_dir: Path) -> Path:
    makensis = shutil.which("makensis")
    if makensis is None and sys.platform == "win32":
        default_makensis = Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "NSIS" / "makensis.exe"
        if default_makensis.exists():
            makensis = str(default_makensis)

    if makensis is None:
        raise RuntimeError(
            "NSIS is required on Windows to create an installer. Install it with 'choco install nsis -y'."
        )

    nsis_root = temp_dir / "nsis"
    app_dir = nsis_root / "app"
    copy_bundle(eve_app_dir, app_dir)
    shutil.copy2(ROOT / "README.md", nsis_root / "README.md")

    output_name = f"eve-{version}-windows-{arch}-setup.exe"
    script_path = nsis_root / "installer.nsi"
    script_path.write_text(windows_nsis_script(version=version, output_name=output_name), encoding="utf-8")
    run([makensis, str(script_path)], cwd=nsis_root)

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
        _, eve_app_dir = build_binary(temp_dir=temp_dir)

        if target == "macos":
            eve_desktop_app = build_macos_desktop_app(temp_dir=temp_dir, version=version)
            desktop_app_output = output_dir / f"eve-{version}-macos-{arch}.app"
            copy_bundle(eve_desktop_app, desktop_app_output)
            installer = build_macos_pkg(
                version=version,
                arch=arch,
                eve_app_dir=eve_app_dir,
                eve_desktop_app=eve_desktop_app,
                output_dir=output_dir,
                temp_dir=temp_dir,
            )
            print(f"Desktop app generated: {desktop_app_output}")
        elif target == "linux":
            installer = build_linux_deb(
                version=version,
                eve_app_dir=eve_app_dir,
                output_dir=output_dir,
                temp_dir=temp_dir,
            )
        elif target == "windows":
            installer = build_windows_installer(
                version=version,
                arch=arch,
                eve_app_dir=eve_app_dir,
                output_dir=output_dir,
                temp_dir=temp_dir,
            )
        else:
            raise RuntimeError(f"Unsupported target: {target}")

    print(f"Installer generated: {installer}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
