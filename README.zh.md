# eve

中文 | [English](README.md)

`eve` 全称为 `eavesdropper`。

一个跨平台的麦克风长时间录音工具：实时录音并自动转写，默认使用 Qwen3-ASR；VAD 仅保留有人说话的部分并只对说话段做转写。eve 面向需要"长时间、低打扰、可检索"录音的场景，提供持续录音、分段存储与实时转写，适用于会议记录、访谈纪要、学习复盘与个人日志等。

## 引言

> 好吧，数字化时代，我承认它离我们还比较遥远。在我能够真正的数字化飞升之前，我决定把我的声音完完整整地保留下来。所以，我开发了这个产品，帮我全天二十四小时不间断地监听我的声音。对，所以我有两个比较重点的东西：一个是会一直保存我的录音，另一个是提供数字转写的能力。可能现在的 AI 模型还不够强大，那些能力也没有那么强，所以先留着录音，等以后有升级的识别或更强的语音识别模型再处理。现在也支持关闭 ASR，先录音后用 `eve transcribe` 异步处理历史音频。

## 功能特性

- 长时间连续录音：面向全天或多小时录制场景。
- 自动分段存储：按时间切片生成 FLAC（无损压缩）文件，便于管理与回放。
- 实时转写：录音过程中持续输出转写文本（JSON）。
- VAD 语音检测：仅保留有人说话的片段，减少无效内容。
- 麦克风自动切换：可自动探测并切到当前"有声"的输入设备。
- 桌面客户端：Electron + React 桌面应用，支持托盘常驻与开机自启动。
- 轻量控制台反馈：单行音量条与状态提示，便于确认正在正常录音。
- 日志式归档：录音与转写按日期归档，便于检索与复盘。
- ASR 可关闭：支持离线/异步转写已有录音。

## 桌面应用预览

![eve 桌面应用](docs/images/desktop-gui-preview.png)

## 下载安装

从 GitHub Releases 下载最新桌面客户端：

- 发布页面：[nexmoe/eve Releases](https://github.com/nexmoe/eve/releases)
- macOS：下载最新 `.pkg` 安装包
- Windows：下载最新 `.exe` 安装包

桌面客户端支持自动检查更新、后台下载，以及在退出时自动安装更新。

## OneDrive 云端同步（常见用法）

将输出目录设为 OneDrive 的本地下载目录后，录音 `.flac`（或你指定的 `.wav`）和同名转写 `.json`
会一起写入该目录（按日期归档），并由 OneDrive 自动同步到云端。

![OneDrive 输出目录示例](docs/images/onedrive-output-dir-example.png)

也可以把该目录中的转写内容交给其他 AI 生成日报（如 `transcript-summary.md`）：

```text
请读取 /Users/<你的用户名>/Library/CloudStorage/OneDrive-Personal/recordings/YYYYMMDD/ 下的转写 JSON，
按时间线整理"今日纪实、重点提炼、待办事项"，输出为 Markdown 文件 transcript-summary.md。
```

![AI 日报示例](docs/images/ai-daily-report-example.jpeg)

## 默认行为

- 总时长 24 小时，每 60 分钟切一段
- 录音与 JSON 按日期归档到 `recordings/YYYYMMDD/`
- 文件名形如 `eve_live_YYYYMMDD_HHMMSS.flac`
- 同名 `.json`（如 `eve_live_YYYYMMDD_HHMMSS.json`）实时追加转写结果
- 使用 Silero VAD，仅保留有人说话的片段并只对说话段做转写
- 默认开启 ASR，可通过 `--disable-asr` 仅录音

## 输出 JSON 结构（示例）

每个音频段对应一个同名 JSON，录音与转写过程中会持续追加 `speech_segments` 并更新 `text`、`language`、`status`：

```json
{
  "audio_file": "eve_live_20260201_120513.flac",
  "audio_path": "/path/to/recordings/20260201/eve_live_20260201_120513.flac",
  "segment_start": "20260201_120513",
  "segment_start_time": "2026-02-01T12:05:13+08:00",
  "model": "Qwen/Qwen3-ASR-0.6B",
  "status": "ok",
  "speech_segments": [
    {
      "start_time_iso": "2026-02-01T12:05:14.200000+08:00",
      "end_time_iso": "2026-02-01T12:05:16.700000+08:00",
      "language": "Chinese",
      "text": "不宜长时间久坐，请升起升降桌。"
    }
  ],
  "language": "Chinese",
  "text": "不宜长时间久坐，请升起升降桌。"
}
```

## 其他说明

- 运行中若麦克风不可用，会自动重试。
- 自动切麦使用阈值 + 防抖策略，默认忽略 iPhone/Continuity 设备。
- 启用 ASR 时，控制台会固定两行区域刷新：第一行显示录音状态，第二行显示最近转写历史。
- 运行中按 `Ctrl+C` 可提前停止。

## 更多文档

- [CLI 命令行使用指南](docs/cli.zh.md) — 完整的命令行参数与用法
- [开发者指南](docs/development.zh.md) — 环境搭建、构建与 CI/CD
