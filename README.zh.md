# eve

中文 | [English](README.md)

`eve` 全称 `eavesdropper`。

`eve` 是一个以托盘常驻为核心的桌面录音应用。它可以长时间录制麦克风、自动分段存档，并使用 `sherpa-onnx` 的 Qwen3 ASR 与 sherpa VAD 做实时转写和离线补转写。

## 功能特性

- 长时间麦克风录音与自动分段
- 基于 Qwen3 ASR 的实时转写
- 基于 sherpa VAD 的语音检测
- 手动选择麦克风，并可自动切到更活跃的输入设备
- 同时支持 WAV 与 FLAC 输出
- 支持对已有 WAV/FLAC 录音做批量转写
- Electron 托盘应用，支持开机自启与自动更新

## 桌面应用预览

![eve 桌面应用](docs/images/desktop-gui-preview.png)

## 下载

- 发布页面：[nexmoe/eve Releases](https://github.com/nexmoe/eve/releases)
- macOS：最新 `.pkg`
- Windows：最新 `.exe`

打包后的桌面端支持自动检查更新，并在退出时安装已下载的更新。

## 运行说明

- 首次开始录音或转写时，`eve` 会自动下载 Qwen3 ASR 和 VAD 模型，并缓存到应用用户数据目录。
- 使用 FLAC 输出或转写非 WAV 文件时需要 `ffmpeg`。在 macOS 上可执行：

```bash
brew install ffmpeg
```

## 输出内容

- 音频和同名 JSON 会按日期归档到 `recordings/YYYYMMDD/`
- 文件名形如 `eve_YYYYMMDD_HHMMSS.wav` 或 `.flac`
- 每个分段都会写出同名 `.json`，保存转写文本和元数据

示例 JSON：

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
  "text": "请起来活动一下。"
}
```

## 更多文档

- [开发者指南](docs/development.zh.md)
