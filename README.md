# eve

English | [中文](README.zh.md)

`eve` stands for `eavesdropper`.

A cross-platform long-running microphone recorder with real-time transcription. It uses Qwen3-ASR by default. VAD keeps only speech segments and transcribes speech-only chunks. `eve` is designed for long-duration, low-friction, searchable recording workflows, such as meetings, interviews, study reviews, and personal voice logs.

## Intro

Before fully digitalizing my memory, I want to preserve my voice data continuously. So this tool focuses on two things: persistent recording and transcription. If current AI is not good enough for your needs, you can keep recordings first and re-transcribe later with stronger models. You can also disable ASR and process historical audio asynchronously via `eve transcribe`.

## Features

- Long-running continuous recording for all-day or multi-hour sessions.
- Automatic segmenting into FLAC files for easier management and playback.
- Real-time transcription to JSON during recording.
- VAD-based speech detection to skip silence and reduce noise.
- Automatic microphone switching to the currently active input source.
- Lightweight console feedback with single-line level/status output.
- Date-based archival for both audio and transcription files.
- Optional ASR disable mode for recording-only workflows.

## OneDrive Sync (Common Workflow)

Set the output directory to your local OneDrive folder. Audio (`.flac` or `.wav`) and matching transcription files (`.json`) will be written there (grouped by date) and then synced to cloud automatically.

```bash
uv run eve --output-dir /Users/air15/Library/CloudStorage/OneDrive-Personal/recordings/
```

![OneDrive output directory example](docs/images/onedrive-output-dir-example.png)

You can also pass the daily transcription files to another AI to generate a daily report (for example `transcript-summary.md`):

```text
Read transcription JSON files under
/Users/<your-username>/Library/CloudStorage/OneDrive-Personal/recordings/YYYYMMDD/,
and generate a timeline summary with key highlights and todos as transcript-summary.md.
```

![AI daily report example](docs/images/ai-daily-report-example.jpeg)

## Quick Start

### 1) Requirements

- Python >= 3.12
- [uv](https://docs.astral.sh/uv/) (recommended for dependency and runtime management)

```bash
brew install uv
```

### 2) Install and Run

From project root:

```bash
uv sync
uv run eve
```

### Configuration Requirements

Before first run, confirm the following:

- Output directory is writable: default path is `recordings/YYYYMMDD/`; use `--output-dir` to customize.
- Microphone permission is granted: on macOS, allow your terminal/app in `System Settings -> Privacy & Security -> Microphone`.
- ASR model is available: default is `Qwen/Qwen3-ASR-0.6B`; first load needs network download. For offline usage, pre-cache the model or set a local path with `--asr-model /path/to/model`.
- Inference device is available: default `--asr-device` is `auto`, which falls back to CPU when GPU/NPU is unavailable.
- Resource guidance (empirical):
  - Recording only (`--disable-asr`): suggested memory `2GB+`, dual-core CPU is enough.
  - Recording + real-time ASR (CPU): suggested memory `8GB+` (minimum `4GB`), recommended 4+ CPU cores.
  - Recording + real-time ASR (GPU/NPU): suggested memory `8GB+`; significantly lowers CPU usage and improves real-time stability.
  - Disk space: highly dependent on duration; reserve at least `10GB` for long-running archives and JSON outputs.

If you already have an activated virtual environment:

```bash
uv venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
uv sync
eve
```

## Build Cross-Platform Installers

> Note: installers must be built natively on each target OS. One OS cannot directly cross-build all formats.
> A CI matrix workflow is included to build macOS / Linux / Windows installers in one trigger.

### Local build (current OS)

```bash
uv run --with pyinstaller scripts/build_installers.py
```

Default output directory: `dist/installers/`

Installers contain one core binary `eve`. Offline transcription is available through `eve transcribe`, so there is no duplicate runtime packaging.

- macOS: `eve-<version>-macos-<arch>.pkg`
- Linux: `eve_<version>_<arch>.deb`
- Windows: `eve-<version>-windows-<arch>-setup.exe`

Local prerequisites:

- macOS: `pkgbuild` (built-in)
- Linux: `dpkg-deb`
- Windows: `makensis` (install via `choco install nsis -y`)

### CI build for all 3 platforms

Workflow file: `.github/workflows/build-installers.yml`

- Manual trigger: GitHub Actions `workflow_dispatch`
- Automatic trigger: push a `v*` tag (for example `v0.2.1`)

Artifacts for each OS are uploaded to GitHub Actions Artifacts.

### 3) Default Behavior

- Total duration: 24 hours; each segment: 60 minutes
- Audio and JSON are archived under `recordings/YYYYMMDD/`
- File name pattern: `eve_live_YYYYMMDD_HHMMSS.flac`
- Matching `.json` (for example `eve_live_YYYYMMDD_HHMMSS.json`) is updated continuously
- Uses Silero VAD and only transcribes speech chunks
- ASR is enabled by default; disable with `--disable-asr`

## Common Usage

### List audio devices

```bash
eve --list-devices
```

Use `--device` to select microphone (default is `default`). Supports device index, device name, or `:index`:

```bash
eve --device 2
eve --device "Built-in Microphone"
```

Auto switch to active microphone is enabled by default:

```bash
eve
```

For stricter debounce behavior, increase confirmation count and cooldown:

```bash
eve \
  --auto-switch-confirmations 3 \
  --auto-switch-cooldown-seconds 12
```

Disable automatic mic switching:

```bash
eve --no-auto-switch-device
```

Disable real-time console volume feedback:

```bash
eve --no-console-feedback
```

### Customize output and segment length

```bash
eve --output-dir recordings --segment-minutes 30 --total-hours 3
```

### Record without transcription (disable ASR)

```bash
eve --disable-asr
```

### Asynchronously transcribe existing recordings

```bash
eve transcribe --input-dir recordings
```

Watch continuously for new files and transcribe:

```bash
eve transcribe --input-dir recordings --watch
```

### Adjust audio format

Default audio settings: FLAC (lossless) / 16kHz / mono. Use `--audio-format wav` to switch back to WAV.

## Configuration Parameters

The tables below list all configuration parameters by category with default values.

### Device and Output

| Parameter | Description | Default |
| --- | --- | --- |
| `--device` | Microphone device (index / name / `:index`) | `default` |
| `--output-dir` | Output directory for recordings | `recordings` |
| `--audio-format` | Archive format (`flac` lossless / `wav` uncompressed) | `flac` |
| `--device-check-seconds` | Device availability check interval (seconds, <=0 to disable) | `2` |
| `--device-retry-seconds` | Retry interval after mic error (seconds) | `2` |
| `--auto-switch-device` / `--no-auto-switch-device` | Auto-switch to currently active input device | `true` |
| `--auto-switch-scan-seconds` | Auto-switch scan interval (seconds) | `3` |
| `--auto-switch-probe-seconds` | Probe duration per candidate device (seconds) | `0.25` |
| `--auto-switch-max-candidates-per-scan` | Max candidates to probe per scan | `2` |
| `--exclude-device-keywords` | Device-name keywords to ignore when selecting/switching (comma-separated) | `iphone,continuity` |
| `--auto-switch-min-rms` | Minimum RMS to treat a candidate as active | `0.006` |
| `--auto-switch-min-ratio` | Minimum volume ratio vs current device | `1.8` |
| `--auto-switch-cooldown-seconds` | Cooldown between switches (seconds) | `8` |
| `--auto-switch-confirmations` | Consecutive wins needed before switching | `2` |
| `--console-feedback` / `--no-console-feedback` | Toggle single-line console recording feedback | `true` |
| `--console-feedback-hz` | Console feedback refresh frequency (Hz) | `12` |

### Recording Duration and Segments

| Parameter | Description | Default |
| --- | --- | --- |
| `--total-hours` | Total recording duration (hours) | `24` |
| `--segment-minutes` | Segment length (minutes) | `60` |

### Audio Format

Default: FLAC (lossless), 16kHz, mono. Use `--audio-format wav` to switch to WAV.

### VAD

Silero VAD is used to filter silence and only transcribe speech segments.
JSON output includes timestamp and transcription for each detected speech segment.

To keep transcription near real-time, one continuous speech segment is force-split at 20 seconds by default.

### Tools

| Parameter | Description | Default |
| --- | --- | --- |
| `--list-devices` | List available devices and exit | `false` |

### ASR Model and Device

| Parameter | Description | Default |
| --- | --- | --- |
| `--disable-asr` | Disable real-time ASR, record audio only | `false` |
| `--asr-model` | Qwen3-ASR model ID or local path | `Qwen/Qwen3-ASR-0.6B` |
| `--asr-language` | Language name or `auto` | `auto` |
| `--asr-device` | Inference device (`auto` / `cuda:0` / `mps` / `cpu`) | `auto` |
| `--asr-dtype` | Compute dtype (`auto` / `float16` / `bfloat16` / `float32`) | `auto` |

### ASR Inference

| Parameter | Description | Default |
| --- | --- | --- |
| `--asr-max-new-tokens` | Max new decoding tokens | `256` |
| `--asr-max-batch-size` | Inference batch size | `1` |
| `--asr-preload` | Preload ASR model before recording starts | `false` |

## ASR Dependencies

ASR transcription is optional. Dependencies are included in default install and only needed for real-time transcription or `eve transcribe`:

```bash
uv sync
```

When ASR is disabled, no model is loaded and only audio is recorded. You can later generate `.json` with `eve transcribe`.

## Notes

- Recording relies on `sounddevice`; device list is based on `eve --list-devices`.
- If mic becomes unavailable at runtime, retry is automatic based on `--device-retry-seconds`.
- Device auto-switch uses threshold + debounce strategy and can be disabled with `--no-auto-switch-device`.
- By default, input devices containing `iphone` or `continuity` are ignored to avoid frequent interruptions from Continuity Mic disconnects; customize via `--exclude-device-keywords`.
- Single-line volume feedback is enabled by default (in-place refresh, no log flooding); disable with `--no-console-feedback`.
- With ASR enabled, the console keeps two fixed lines: line 1 for recording status, line 2 for recent transcription history.
- Press `Ctrl+C` to stop early. You can also run `python -m eve` instead of `eve`.

## Output JSON Structure (Example)

Each audio segment has a same-name JSON file. During recording/transcription, `speech_segments` is appended continuously and `text`, `language`, and `status` are updated.

```json
{
  "audio_file": "eve_live_20260201_120513.flac",
  "audio_path": "/path/to/recordings/20260201/eve_live_20260201_120513.flac",
  "segment_start": "20260201_120513",
  "segment_start_time": "2026-02-01T12:05:13+08:00",
  "model": "Qwen/Qwen3-ASR-0.6B",
  "backend": "transformers",
  "created_at": "2026-02-01T04:05:18.132908+00:00",
  "device": null,
  "dtype": null,
  "input_device": "2:Built-in Microphone",
  "auto_switch_device": true,
  "asr_enabled": true,
  "asr_mode": "live",
  "status": "ok",
  "speech_segments": [
    {
      "start_time_iso": "2026-02-01T12:05:14.200000+08:00",
      "end_time_iso": "2026-02-01T12:05:16.700000+08:00",
      "language": "Chinese",
      "text": "Avoid sitting too long; please raise the standing desk."
    }
  ],
  "language": "Chinese",
  "text": "Avoid sitting too long; please raise the standing desk."
}
```

- `device` and `dtype` are the actual ASR device/precision; they may be `null` before model load.
- `input_device` is the actual input device used for this segment (`index:name`).
- `auto_switch_device` indicates whether auto-switch was enabled for this segment.
- `asr_mode` is one of `"live"` (real-time), `"disabled"` (record-only), or `"offline"` (offline transcription).
- During recording, `status` is `"recording"`; after completion it may be `"ok"`, `"pending_asr"`, `"no_speech"`, or `"no_text"`.
- Offline transcription outputs `start_seconds` / `end_seconds` (relative to audio), not the absolute timestamps used in live recording.
