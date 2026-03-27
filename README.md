# eve

English | [中文](README.zh.md)

`eve` stands for `eavesdropper`.

`eve` is a tray-first desktop recorder built with Electron. It records microphone audio for long sessions, segments files automatically, and uses `sherpa-onnx` with Qwen3 ASR plus sherpa VAD for live transcription and offline reprocessing.

## Features

- Long-running microphone recording with automatic segmentation
- Live transcription with Qwen3 ASR
- Sherpa VAD speech detection
- Manual microphone selection plus automatic switch to the more active input
- WAV and FLAC output
- Batch transcription of existing WAV/FLAC recordings
- Electron tray app with launch-at-login and auto-update support

## Desktop Preview

![eve desktop app](docs/images/desktop-gui-preview.png)

## Download

- Release page: [nexmoe/eve Releases](https://github.com/nexmoe/eve/releases)
- macOS: latest `.pkg`
- Windows: latest `.exe`

The packaged app supports automatic update checks and install-on-quit updates.

## Runtime Notes

- `eve` downloads Qwen3 ASR and VAD assets on first use and stores them under the app user-data directory.
- `ffmpeg` is required for FLAC output and for transcribing non-WAV input. On macOS:

```bash
brew install ffmpeg
```

## Output

- Audio and transcript JSON files are archived under `recordings/YYYYMMDD/`
- Filenames look like `eve_YYYYMMDD_HHMMSS.wav` or `.flac`
- Each segment writes a matching `.json` with transcript text and metadata

Example JSON:

```json
{
  "audio_file": "eve_20260201_120513.wav",
  "audio_path": "/path/to/recordings/20260201/eve_20260201_120513.wav",
  "backend": "sherpa-onnx",
  "created_at": "2026-02-01T12:05:13.000Z",
  "input_device": "MacBook Air Microphone",
  "model": "Qwen3 ASR",
  "segment_start_time": "2026-02-01T12:05:13.000Z",
  "status": "ok",
  "text": "Please stand up and stretch for a minute."
}
```

## More Documentation

- [Development Guide](docs/development.md)
