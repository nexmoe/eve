# Development Guide

[← Back to README](../README.md)

## Project Structure

```text
apps/desktop        Electron main/preload/renderer, tray, packaging
packages/shared     Shared TypeScript contracts for main + renderer
```

## Requirements

- [Bun](https://bun.sh/) >= 1.3.2
- `ffmpeg` for FLAC output and non-WAV transcription

```bash
brew install bun ffmpeg
```

## Install

```bash
bun install
```

## Development

```bash
bun run dev:desktop
```

The app is Electron-only. There is no Python runtime or CLI sidecar anymore.

## Checks

```bash
bun run typecheck
bun run test
```

## Build Packages

```bash
bun run build
cd apps/desktop
bun run build:mac
bun run build:win
```

Build targets:

- macOS: `.dmg`, `.zip`, `.pkg`
- Windows: NSIS `.exe`

## Notes

- Models download on first use into the app user-data directory.
- `sherpa-onnx-node` is bundled with the Electron app and unpacked for production builds.
- New source files should stay under 500 lines.
