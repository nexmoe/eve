# Changelog

All notable changes to this project are documented in this file.

## 0.4.2 - 2026-03-19

### Fixes
- Improve macOS installer packaging by splitting CLI/Desktop packages and setting bundle version metadata.

## 0.4.1 - 2026-03-18

### CI
- Temporarily remove Ubuntu installer builds from GitHub Actions matrix.

## 0.4.0 - 2026-03-18

### Features
- Add desktop app runtime and skill-packaged workflow.

### Fixes
- Fix speech segment loss during segment rotation (by @jeasonzhang-eth).
- Fix macOS recorder stalls and improve default switching behavior.

## 0.3.6 - 2026-02-28

### Features
- Add `--version` / `-v` flags to show CLI version from both the root command and subcommands.

### Fixes
- Improve packaged runtime resilience by normalizing working directory and model/resource path resolution.

## 0.3.5 - 2026-02-23

### Features
- Add startup console UI with welcome panels and spinner statuses for record and transcribe commands

### Fixes
- Fix ASR packaging for frozen builds by including required data files for nagisa, qwen_asr, and silero_vad

## 0.3.4 - 2026-02-23

### CI
- Drop Ubuntu/Linux installer builds from CI pipeline.

## 0.3.3 - 2026-02-23

### CI
- Publish installer artifacts automatically on tagged releases.

## 0.3.2 - 2026-02-21

### Fixes
- Fix installer packaging for large PyInstaller builds by switching to onedir mode.

## 0.3.1 - 2026-02-21

### Documentation
- Make README default to English with separate Chinese translation.

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
