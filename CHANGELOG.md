# Changelog

All notable changes to this project are documented in this file.

## 0.3.0 - 2026-02-21

### Features
- Add cross-platform installer workflow for macOS, Linux, and Windows.
- Unify CLI into a single `eve` entrypoint and support `eve transcribe`.

### Documentation
- Add installer build and CI workflow usage in README.
- Update command examples from `eve-transcribe` to `eve transcribe`.

## 0.2.0 - 2026-02-20

### Features
- Add lossless FLAC archive support with `--audio-format` (`flac` default, `wav` optional).
- Support both WAV and FLAC input scanning in `eve-transcribe`.
- Improve recorder resilience and live recording UX.
- Improve ASR console output and history rendering with timestamps.

### Fixes
- Handle empty audio files safely in the offline transcription pipeline.

### Documentation
- Update README device examples to be cross-platform.
- Add OneDrive sync usage examples.
- Document FLAC as default archive format and refresh JSON examples.

### Refactor
- Rename project to `eve` and reorganize modules.

## 0.1.0 - 2026-02-01

### Features
- Initial release with continuous recording, VAD-based speech capture, and Qwen ASR transcription.
