# 开发者指南

[← 返回 README](../README.zh.md)

## 项目结构

```text
apps/desktop        Electron 主进程 / preload / renderer、托盘、打包
packages/shared     主进程与渲染进程共享的 TypeScript 类型
```

## 环境要求

- [Bun](https://bun.sh/) >= 1.3.2
- `ffmpeg`，用于 FLAC 输出和非 WAV 转写

```bash
brew install bun ffmpeg
```

## 安装依赖

```bash
bun install
```

## 开发运行

```bash
bun run dev:desktop
```

现在项目已经是纯 Electron 架构，不再包含 Python runtime 或 sidecar CLI。

## 检查与测试

```bash
bun run typecheck
bun run test
```

## 构建安装包

```bash
bun run build
cd apps/desktop
bun run build:mac
bun run build:win
```

构建产物：

- macOS：`.dmg`、`.zip`、`.pkg`
- Windows：NSIS `.exe`

## 说明

- 模型会在首次使用时下载到应用用户数据目录。
- `sherpa-onnx-node` 会随 Electron 应用一起打包，并在生产构建时解包原生模块。
- 新文件不超过 500 行。
