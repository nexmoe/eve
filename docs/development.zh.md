# 开发者指南

[← 返回 README](../README.zh.md)

## 项目结构

```text
apps/desktop        Electron 主进程/预加载/渲染进程、托盘、打包、CI 入口
packages/shared     桌面端与渲染进程共享的 TypeScript 类型
src/eve             Python 录音 / VAD / ASR 核心，作为 sidecar 运行时使用
```

## 环境要求

- Python >= 3.12
- [uv](https://docs.astral.sh/uv/)（Python 依赖管理）
- [Bun](https://bun.sh/) >= 1.3.2（前端与桌面端）

```bash
brew install uv bun
```

## 安装依赖

```bash
bun install
uv sync
```

## 开发运行

```bash
bun run dev:desktop
```

Electron 应用从 `apps/desktop` 启动，会自动拉起 Python sidecar。

也可以只运行 Python CLI：

```bash
uv run eve
```

如果要启动旧版托盘模式：

```bash
uv run eve desktop
```

## 类型检查与测试

```bash
bun run typecheck
bun run test
uv run --with pytest pytest apps/desktop/vendor/eve-sidecar/tests
```

## 构建桌面安装包

```bash
bun run build
cd apps/desktop
bun run build:mac
bun run build:win
```

构建产物：

- macOS: `.dmg`, `.zip`, `.pkg`
- Windows: NSIS `.exe`

### Python Sidecar 运行时

桌面应用在打包前需要准备捆绑的 Python 运行时：

```bash
cd apps/desktop
bun run prepare:shared-runtime
```

运行时输出到 `apps/desktop/.generated/shared-python-runtime`，生产包会捆绑此运行时，用户无需安装系统 Python。

## CI/CD

GitHub Actions 工作流：`.github/workflows/desktop-release.yml`

- `checks`：类型检查 + JS 测试 + Python sidecar 测试
- `build`：macOS + Windows 安装包
- `publish`：`desktop-v*` tag 触发发布安装包、自动更新元数据与校验和

签名 secrets 为可选，未配置时仍可构建未签名包。

如需接入 macOS 签名，在 GitHub Actions 中配置以下 secrets：

- `MACOS_CERTIFICATE_P12_BASE64`
- `MACOS_CERTIFICATE_PASSWORD`
- `MACOS_CODESIGN_IDENTITY`
- `MACOS_INSTALLER_IDENTITY`

## ASR 依赖

ASR 转写为可选功能，依赖已包含在默认安装中。仅在实时转写或使用 `eve transcribe` 时需要。

关闭 ASR 时仅录音，不会加载模型；后续可用 `eve transcribe` 异步生成 `.json` 转写结果。

### 资源建议

- 仅录音（`--disable-asr`）：内存 `2GB+`，CPU 双核即可
- 录音 + 实时转写（CPU）：内存 `8GB+`（最低 `4GB`），建议 4 核及以上
- 录音 + 实时转写（GPU/NPU）：内存 `8GB+`，可显著降低 CPU 占用
- 磁盘空间：建议预留至少 `10GB` 用于长期归档

## 贡献者须知

- 新文件不超过 500 行。
- 不要重新引入 `flet`、`pystray` 或旧版 PyInstaller 打包路径。
- Electron 为设置与权限的唯一入口。
- Python 仅作为音频工作的执行基础设施，不作为桌面壳。
