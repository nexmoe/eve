# CLI 命令行使用指南

[← 返回 README](../README.zh.md)

## 快速开始

```bash
uv sync
uv run eve
```

## 列出音频设备

```bash
eve --list-devices
```

用 `--device` 选择麦克风（默认 `default`），支持设备索引、设备名或 `:索引`：

```bash
eve --device 2
eve --device "Built-in Microphone"
```

## 麦克风自动切换

使用默认输入设备时，会默认开启"有声麦克风自动切换"：

```bash
eve
```

当显式指定 `--device`（例如 `--device 3`）时，默认关闭自动切麦；如需开启可手动指定：

```bash
eve --device 3 --auto-switch-device
```

需要更严格防抖时可调高确认次数和切换冷却时间：

```bash
eve \
  --auto-switch-confirmations 3 \
  --auto-switch-cooldown-seconds 12
```

如需关闭自动切麦：

```bash
eve --no-auto-switch-device
```

如果不希望显示实时音量条：

```bash
eve --no-console-feedback
```

## 自定义输出与分段

```bash
eve --output-dir recordings --segment-minutes 30 --total-hours 3
```

## OneDrive 云端同步

```bash
uv run eve --output-dir /Users/<你的用户名>/Library/CloudStorage/OneDrive-Personal/recordings/
```

## 录音但不转写（关闭 ASR）

```bash
eve --disable-asr
```

## 异步转写已有录音

```bash
eve transcribe --input-dir recordings
```

持续监听新文件并转写：

```bash
eve transcribe --input-dir recordings --watch
```

## 桌面 CLI 包装命令

打包后的桌面应用包含 `eve` 命令行包装，支持以下命令：

```bash
eve open
eve status
eve record start
eve record stop
eve transcribe run --input-dir /absolute/path/to/recordings
```

## 配置参数一览

### 设备与输出

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `--device` | 麦克风设备（索引 / 名称 / `:索引`） | `default` |
| `--output-dir` | 录音输出目录 | `recordings` |
| `--audio-format` | 归档音频格式（`flac` 无损压缩 / `wav` 未压缩） | `flac` |
| `--device-check-seconds` | 麦克风可用性检测间隔（秒，<=0 关闭） | `2` |
| `--device-retry-seconds` | 麦克风异常后重试间隔（秒） | `2` |
| `--auto-switch-device` / `--no-auto-switch-device` | 自动切换到当前有声输入设备 | auto |
| `--auto-switch-scan-seconds` | 自动切换扫描间隔（秒） | `3` |
| `--auto-switch-probe-seconds` | 每个候选设备的探测时长（秒） | `0.25` |
| `--auto-switch-max-candidates-per-scan` | 每次扫描最多探测的候选麦克风数量 | `2` |
| `--exclude-device-keywords` | 要忽略的设备名关键词（逗号分隔） | `iphone,continuity` |
| `--auto-switch-min-rms` | 候选麦克风被判定为"有声"的最小 RMS | `0.006` |
| `--auto-switch-min-ratio` | 候选设备相对当前设备的最小音量倍率 | `1.8` |
| `--auto-switch-cooldown-seconds` | 两次切换间的最短冷却时间（秒） | `8` |
| `--auto-switch-confirmations` | 同一候选设备连续胜出的次数阈值 | `2` |
| `--console-feedback` / `--no-console-feedback` | 开关控制台单行录音反馈 | `true` |
| `--console-feedback-hz` | 控制台反馈刷新频率（Hz） | `12` |

### 录音时长与分段

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `--total-hours` | 总录音时长（小时） | `24` |
| `--segment-minutes` | 分段时长（分钟） | `60` |

### ASR 模型与设备

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `--disable-asr` | 关闭实时转写，仅录音 | `false` |
| `--asr-model` | Qwen3-ASR 模型 ID 或本地路径 | `Qwen/Qwen3-ASR-0.6B` |
| `--asr-language` | 语言名称或 `auto` 自动检测 | `auto` |
| `--asr-device` | 推理设备（auto / cuda:0 / mps / cpu） | `auto` |
| `--asr-dtype` | 计算精度（auto / float16 / bfloat16 / float32） | `auto` |

### ASR 推理

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `--asr-max-new-tokens` | 解码最大新 token 数 | `256` |
| `--asr-max-batch-size` | 推理批大小 | `1` |
| `--asr-preload` | 录音前预加载模型 | `false` |

### 工具

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `-V, --version` | 显示版本号并退出 | - |
| `--list-devices` | 列出可用设备并退出 | `false` |
