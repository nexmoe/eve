# Development Guide

[← Back to README](../README.md)

## Project Structure

```text
apps/desktop        Electron main/preload/renderer, tray, packaging, CI entry
packages/shared     Shared TypeScript contracts for desktop + renderer
src/eve             Python recording / VAD / ASR core, used as sidecar runtime
```

## Requirements

- Python >= 3.12
- [uv](https://docs.astral.sh/uv/) (Python dependency management)
- [Bun](https://bun.sh/) >= 1.3.2 (frontend and desktop)

```bash
brew install uv bun
```

## Install Dependencies

```bash
bun install
uv sync
```

## Development

```bash
bun run dev:desktop
```

The Electron app starts from `apps/desktop` and spawns the Python sidecar automatically.

You can also run the Python CLI directly:

```bash
uv run eve
```

To start the legacy tray mode:

```bash
uv run eve desktop
```

## Typecheck and Test

```bash
bun run typecheck
bun run test
uv run --with pytest pytest apps/desktop/vendor/eve-sidecar/tests
```

## Build Desktop Packages

```bash
bun run build
cd apps/desktop
bun run build:mac
bun run build:win
```

Build targets:

- macOS: `.dmg`, `.zip`, `.pkg`
- Windows: NSIS `.exe`

### Python Sidecar Runtime

The desktop app prepares a bundled Python runtime before packaging:

```bash
cd apps/desktop
bun run prepare:shared-runtime
```

The runtime is written to `apps/desktop/.generated/shared-python-runtime`. Production packages bundle this runtime so end users do not need system Python.

## CI/CD

GitHub Actions workflow: `.github/workflows/desktop-release.yml`

- `checks`: typecheck + JS tests + Python sidecar tests
- `build`: macOS + Windows packages
- `publish`: `desktop-v*` tags release installers, auto-update metadata, and checksum artifacts

Signing secrets are optional. Unsigned builds still work when secrets are absent.

To enable macOS signing, configure these GitHub Actions secrets:

- `MACOS_CERTIFICATE_P12_BASE64`
- `MACOS_CERTIFICATE_PASSWORD`
- `MACOS_CODESIGN_IDENTITY`
- `MACOS_INSTALLER_IDENTITY`

## ASR Dependencies

ASR transcription is optional and included in the default install. Only required for real-time transcription or `eve transcribe`.

With ASR disabled, only recording runs — no model is loaded. Use `eve transcribe` later to generate `.json` transcription results.

### Resource Recommendations

- Recording only (`--disable-asr`): `2GB+` RAM, dual-core CPU
- Recording + real-time transcription (CPU): `8GB+` RAM (minimum `4GB`), 4+ cores recommended
- Recording + real-time transcription (GPU/NPU): `8GB+` RAM, significantly reduces CPU load
- Disk space: at least `10GB` free for long-term archiving

## Notes for Contributors

- New source files should stay under 500 lines.
- Do not reintroduce `flet`, `pystray`, or the old PyInstaller installer path.
- Electron is the source of truth for settings and permissions.
- Python is execution infrastructure for audio work, not the desktop shell.
