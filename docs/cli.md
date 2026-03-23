# CLI Reference

[← Back to README](../README.md)

## Quick Start

```bash
uv sync
uv run eve
```

## List Audio Devices

```bash
eve --list-devices
```

Use `--device` to select a microphone (default: `default`). Supports device index, name, or `:index`:

```bash
eve --device 2
eve --device "Built-in Microphone"
```

## Automatic Microphone Switching

When using the default input device, automatic switching to the active microphone is enabled by default:

```bash
eve
```

When a device is explicitly specified (e.g., `--device 3`), auto-switch is disabled by default. To enable it manually:

```bash
eve --device 3 --auto-switch-device
```

For stricter debounce, increase confirmation count and cooldown:

```bash
eve \
  --auto-switch-confirmations 3 \
  --auto-switch-cooldown-seconds 12
```

To disable auto-switch:

```bash
eve --no-auto-switch-device
```

To hide the real-time volume bar:

```bash
eve --no-console-feedback
```

## Custom Output and Segmentation

```bash
eve --output-dir recordings --segment-minutes 30 --total-hours 3
```

## OneDrive Cloud Sync

```bash
uv run eve --output-dir /Users/<your-username>/Library/CloudStorage/OneDrive-Personal/recordings/
```

## Record Without Transcription (Disable ASR)

```bash
eve --disable-asr
```

## Async Transcription of Existing Recordings

```bash
eve transcribe --input-dir recordings
```

Watch for new files and transcribe continuously:

```bash
eve transcribe --input-dir recordings --watch
```

## Desktop CLI Wrapper Commands

Packaged desktop builds include an `eve` CLI wrapper with the following commands:

```bash
eve open
eve status
eve record start
eve record stop
eve transcribe run --input-dir /absolute/path/to/recordings
```

## Configuration Reference

### Device and Output

| Parameter | Description | Default |
| --- | --- | --- |
| `--device` | Microphone device (index / name / `:index`) | `default` |
| `--output-dir` | Recording output directory | `recordings` |
| `--audio-format` | Archive audio format (`flac` lossless / `wav` uncompressed) | `flac` |
| `--device-check-seconds` | Microphone availability check interval (seconds, <=0 to disable) | `2` |
| `--device-retry-seconds` | Retry interval after microphone error (seconds) | `2` |
| `--auto-switch-device` / `--no-auto-switch-device` | Auto-switch to active input device | auto |
| `--auto-switch-scan-seconds` | Auto-switch scan interval (seconds) | `3` |
| `--auto-switch-probe-seconds` | Probe duration per candidate device (seconds) | `0.25` |
| `--auto-switch-max-candidates-per-scan` | Max candidate microphones probed per scan | `2` |
| `--exclude-device-keywords` | Device name keywords to ignore (comma-separated) | `iphone,continuity` |
| `--auto-switch-min-rms` | Minimum RMS for a candidate to be considered active | `0.006` |
| `--auto-switch-min-ratio` | Minimum volume ratio of candidate vs. current device | `1.8` |
| `--auto-switch-cooldown-seconds` | Minimum cooldown between switches (seconds) | `8` |
| `--auto-switch-confirmations` | Consecutive wins required for a candidate | `2` |
| `--console-feedback` / `--no-console-feedback` | Toggle single-line console recording feedback | `true` |
| `--console-feedback-hz` | Console feedback refresh rate (Hz) | `12` |

### Recording Duration and Segmentation

| Parameter | Description | Default |
| --- | --- | --- |
| `--total-hours` | Total recording duration (hours) | `24` |
| `--segment-minutes` | Segment duration (minutes) | `60` |

### ASR Model and Device

| Parameter | Description | Default |
| --- | --- | --- |
| `--disable-asr` | Disable real-time transcription, record only | `false` |
| `--asr-model` | Qwen3-ASR model ID or local path | `Qwen/Qwen3-ASR-0.6B` |
| `--asr-language` | Language name or `auto` for detection | `auto` |
| `--asr-device` | Inference device (auto / cuda:0 / mps / cpu) | `auto` |
| `--asr-dtype` | Compute precision (auto / float16 / bfloat16 / float32) | `auto` |

### ASR Inference

| Parameter | Description | Default |
| --- | --- | --- |
| `--asr-max-new-tokens` | Max new tokens for decoding | `256` |
| `--asr-max-batch-size` | Inference batch size | `1` |
| `--asr-preload` | Preload model before recording | `false` |

### Utility

| Parameter | Description | Default |
| --- | --- | --- |
| `-V, --version` | Show version and exit | - |
| `--list-devices` | List available devices and exit | `false` |
