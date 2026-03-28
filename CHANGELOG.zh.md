# 更新日志

本文档记录本项目的重要变更。

## 0.7.0 - 2026-03-28

### 新功能
- 将桌面端 `applySettings` 改为异步：在格式、输出路径或 ASR 相关设置变更时轮换录音分段，并在语言或关闭 ASR 时重建识别器。
- 关闭 ASR 时使用空 JSON 路径、跳过 JSON 写入并清空 ASR 预览与历史；在保存设置时用渲染端 store 记录待处理状态，避免连续快速保存产生竞态。
- 新增 DesktopEngine 单元测试，覆盖关闭 ASR 时的 sidecar 行为。

### 维护
- 桌面发布工作流中将 `actions/checkout` 与 `actions/setup-node` 升级至 v5。

## 0.6.0 - 2026-03-27

### 破坏性变更
- 将桌面端运行时从原有 Python sidecar 流程迁移为 Sherpa + FFmpeg 架构，并同步调整音频处理链路与运行时管理方式。

### 重构
- 围绕 Sherpa/FFmpeg 新链路重构桌面运行时内部实现，精简主进程执行路径。

### 修复
- 避免在打包后的桌面端重复初始化 `electron-log` 的 preload bridge，修复 macOS 上设置窗口白屏对应的 renderer 崩溃。
- 在打包后的 macOS 构建中关闭半透明玻璃托盘窗口样式，回退为稳定的纯色背景，降低桌面窗口渲染异常概率。
- 在桌面主进程中补充打包态 renderer 加载失败与 renderer 进程退出日志，便于发布后的崩溃排查。
- 在发布流程中等待 macOS sign hook 完成，确保签名步骤顺序稳定。
- 在 macOS 签名中跳过 crashpad helper 的 entitlements，避免签名元数据异常。
- 将 macOS inherit entitlements 与应用级 entitlements 分离处理，提升发布签名稳定性。
- 在发布产物中统一跟踪并应用 macOS 签名 entitlements。
- 在发布打包阶段补齐共享 macOS 运行时二进制签名。
- 从发布产物中移除未签名的 macOS pkg，避免分发无效安装包。

## 0.5.15 - 2026-03-24

### 修复
- 修正 macOS `electron-builder` 自定义 sign hook 的脚本路径，确保从 `apps/desktop` 启动的发布构建能在 CI 中正确加载签名脚本，不再解析出重复的 `apps/desktop/apps/desktop/...` 路径。

## 0.5.14 - 2026-03-24

### 修复
- 为 macOS 桌面签名接入自定义 `electron-builder` sign hook：对 `.pak` 资源文件去掉会触发 CI codesign 失败的 entitlements，同时保持应用级 hardened runtime 签名；并将共享 Python runtime 的打包过滤规则补齐到 `Linkhoard` 已验证的范围。

## 0.5.13 - 2026-03-24

### 修复
- 在 CI 中向 electron-builder 传入绝对路径的 macOS entitlements 文件，避免 codesign 在发布签名阶段读取 plist 失败；该调用方式已在本地验证通过。

## 0.5.12 - 2026-03-24

### 修复
- 从共享 Python runtime 中移除 `torch/include` 与 `torch/share`，避免 macOS 发布签名扫描 app bundle 时耗尽文件句柄上限。

## 0.5.11 - 2026-03-24

### 修复
- 在 CI 安装依赖后直接修补 `isbinaryfile`，避免 electron-builder 在 macOS 签名桌面 app bundle 时再次因上游 protobuf 解析崩溃而中断发布。

## 0.5.10 - 2026-03-24

### 修复
- 规范化内置共享 Python runtime 的符号链接，裁剪开发态文件与无关资源，并在打包时排除测试/文档目录，避免 macOS 桌面发布在签名阶段再次触发 `isbinaryfile` 崩溃。

## 0.5.9 - 2026-03-24

### 修复
- 在 macOS 打包阶段跳过对内置共享 Python `site-packages` 目录的逐文件签名扫描，避免桌面发布工作流在扫描运行时资源时再次触发 `isbinaryfile` 崩溃。

## 0.5.8 - 2026-03-24

### 修复
- 更新桌面发布工作流：改为通过 `MAC_CERT_P12_BASE64` 导入临时 macOS keychain，启用 notarization，避免无证书时落回 ad-hoc signing，并修复导致最新发布任务失败的空数组 shell 展开问题。

## 0.5.7 - 2026-03-24

### 修复
- 重构 CI 中的 macOS 签名流程，改为使用临时 keychain，并在桌面发布工作流中启用 notarization。

## 0.5.6 - 2026-03-24

### 修复
- 从实际包含 macOS 无签名构建修复的提交重新发布桌面版本，确保带标签的构建会显式应用 `mac.identity=null` 与 `pkg.identity=null`。

## 0.5.5 - 2026-03-24

### 修复
- Desktop Release：当 CI 未配置 macOS 签名证书时，显式关闭 `mac.identity` 与 `pkg.identity`，避免 arm64 发布构建进入隐式临时签名路径，从而修复打包阶段的 `isbinaryfile` 崩溃。

## 0.5.4 - 2026-03-23

### 性能优化
- 降低桌面端 IPC：主窗口隐藏或已销毁时跳过快照推送；窗口重新显示时用完整快照刷新。
- 移除伴生在状态循环中多余的波形与转写预览消息（相关信息已包含在状态负载中）。

## 0.5.3 - 2026-03-23

### 修复
- Desktop Release：在未配置 Apple 签名密钥时，避免向 `electron-builder` 注入空的 `CSC_*` 环境变量，并关闭身份自动发现以使用临时签名，修复 macOS 构建报错「not a file」。

## 0.5.2 - 2026-03-23

### 修复
- 本地 `electron-builder` 的 macOS/Windows 构建脚本增加 `--publish never`，避免构建时意外触发发布。

### 文档
- 为桌面端 `package.json` 补充 `description` 与 `author` 元数据。

## 0.5.1 - 2026-03-23

### 性能优化
- 缓存托盘快照状态，仅在必要时刷新设备与历史记录，减少桌面主进程中的冗余开销。

## 0.5.0 - 2026-03-23

### 新功能
- 引入 Electron 桌面客户端（托盘 UI、伴生运行时、electron-builder 打包与测试）；新增 Bun 工作区根目录与 `packages/shared`，并以桌面发布 GitHub Action 替代原安装包工作流。
- 在状态总览中展示 VAD 状态（未启动 / 有语音 / 静音）及色调圆点，与设备与电平指标并列；将指标重构为堆叠布局并收紧排版；补充 VAD 相关中英文文案。

## 0.4.3 - 2026-03-19

### 修复
- 抽取安装器脚本的通用辅助逻辑，并补充 macOS 麦克风用途元数据，确保录音权限提示声明完整。

## 0.4.2 - 2026-03-19

### 修复
- 改进 macOS 安装包构建流程：拆分 CLI/Desktop 子包，并写入应用 Bundle 版本元数据。

## 0.4.1 - 2026-03-18

### CI
- 临时从 GitHub Actions 矩阵中移除 Ubuntu 安装包构建。

## 0.4.0 - 2026-03-18

### 新功能
- 新增桌面应用运行时能力与技能打包工作流。

### 修复
- 修复分段轮转时语音片段丢失问题 (by @jeasonzhang-eth)。
- 修复 macOS 录音器卡顿，并优化默认值切换行为。

## 0.3.6 - 2026-02-28

### 新功能
- 新增 `--version` / `-v` 参数，可在根命令和子命令中查看 CLI 版本信息。

### 修复
- 改进打包运行时的稳定性，统一工作目录处理并增强模型/资源路径解析。

## 0.3.5 - 2026-02-23

### 新功能
- 新增启动控制台界面，为录音和转写命令提供欢迎面板和加载状态提示

### 修复
- 修复冻结构建的 ASR 打包问题，补充 nagisa、qwen_asr 和 silero_vad 所需的数据文件

## 0.3.4 - 2026-02-23

### CI
- 从 CI 流水线中移除 Ubuntu/Linux 安装包构建。

## 0.3.3 - 2026-02-23

### CI
- 在创建标签发布时自动发布安装包构件。

## 0.3.2 - 2026-02-21

### 修复
- 修复大体积 PyInstaller 构建的安装包打包问题，切换为 onedir 模式。

## 0.3.1 - 2026-02-21

### 文档
- 将 README 默认语言切换为英文，并新增独立的中文翻译版本。

## 0.3.0 - 2026-02-21

### 新功能
- 新增面向 macOS、Linux、Windows 的跨平台安装包构建工作流。
- 统一命令行为单一 `eve` 入口，并支持通过 `eve transcribe` 执行异步转写。

### 文档
- 在 README 中补充安装包本地构建与 CI 工作流说明。
- 将示例命令从 `eve-transcribe` 更新为 `eve transcribe`。

## 0.2.0 - 2026-02-20

### 新功能
- 新增无损 FLAC 归档支持，提供 `--audio-format`（默认 `flac`，可选 `wav`）。
- `eve-transcribe` 支持同时扫描 WAV 和 FLAC 音频文件。
- 提升录音器稳定性与实时录音体验。
- 改进 ASR 控制台输出与带时间戳的历史展示。

### 修复
- 在离线转写流程中安全处理空音频文件。

### 文档
- 更新 README 的跨平台设备示例。
- 增加 OneDrive 同步用法示例。
- 文档中将 FLAC 设为默认归档格式，并更新 JSON 示例。

### 重构
- 将项目重命名为 `eve` 并重组模块结构。

## 0.1.0 - 2026-02-01

### 新功能
- 首个版本发布：支持连续录音、基于 VAD 的语音片段捕获和 Qwen ASR 转写。
