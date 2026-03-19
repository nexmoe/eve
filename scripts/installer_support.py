from __future__ import annotations

from pathlib import Path


MACOS_MICROPHONE_USAGE_DESCRIPTION = (
    "eve needs microphone access to record and transcribe your audio."
)


def write_unix_launcher(path: Path, target_binary: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(
            [
                "#!/bin/sh",
                f'exec "{target_binary}" "$@"',
                "",
            ]
        ),
        encoding="utf-8",
    )
    current = path.stat().st_mode
    path.chmod(current | 0o755)


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
  File /r "app\\*.*"
  File /oname=README.md "README.md"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR\\_internal"
  Delete "$INSTDIR\\README.md"
  Delete "$INSTDIR\\Uninstall.exe"
  Delete "$INSTDIR\\eve.exe"
  RMDir /r "$INSTDIR"
SectionEnd
"""
