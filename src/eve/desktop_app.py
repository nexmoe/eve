from __future__ import annotations

import asyncio
from copy import deepcopy
from dataclasses import asdict
from io import BytesIO
import json
import logging
import os
import signal
import subprocess
from pathlib import Path
from types import SimpleNamespace
import sys
import threading
import time
from typing import Any
import webbrowser

import flet as ft
from PIL import Image, ImageDraw
import pystray

from .desktop_ipc import (
    consume_commands as ipc_consume_commands,
    desktop_controller_available as ipc_desktop_controller_available,
    enqueue_command as ipc_enqueue_command,
)
from .device_waveform import DeviceWaveformMonitor, WAVEFORM_BIN_COUNT
from .live_monitor import LiveMonitorPanel
from .permissions import (
    PermissionStatus,
    microphone_permission_status,
    open_microphone_privacy_settings,
    request_microphone_permission,
)
from .record_eve_24h import build_transcriber, create_live_recorder
from .settings import (
    AppSettings,
    DesktopSettings,
    RecordingSettings,
    TranscribeSettings,
    load_settings,
    save_settings,
    settings_file,
)
from .startup import launch_at_login_enabled, set_launch_at_login
from .utils.logging_utils import init_logging

LOGGER = logging.getLogger(__name__)
GITHUB_REPO_URL = "https://github.com/nexmoe/eve"


def _desktop_runtime_dir() -> Path:
    return settings_file().parent / "runtime"


def _desktop_window_pid_dir() -> Path:
    return _desktop_runtime_dir() / "windows"


def _desktop_feedback_file() -> Path:
    return _desktop_runtime_dir() / "recorder_feedback.json"


def _window_pid_file(pid: int) -> Path:
    return _desktop_window_pid_dir() / f"{pid}.pid"


def _pid_is_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _register_window_pid(pid: int) -> None:
    pid_dir = _desktop_window_pid_dir()
    pid_dir.mkdir(parents=True, exist_ok=True)
    _window_pid_file(pid).write_text(str(pid), encoding="utf-8")


def _unregister_window_pid(pid: int) -> None:
    try:
        _window_pid_file(pid).unlink()
    except FileNotFoundError:
        pass


def _registered_window_pids() -> list[int]:
    pid_dir = _desktop_window_pid_dir()
    if not pid_dir.exists():
        return []
    active: list[int] = []
    for path in pid_dir.glob("*.pid"):
        try:
            pid = int(path.stem)
        except ValueError:
            path.unlink(missing_ok=True)
            continue
        if _pid_is_running(pid):
            active.append(pid)
        else:
            path.unlink(missing_ok=True)
    return active


def _terminate_registered_window_processes() -> None:
    current_pid = os.getpid()
    for pid in _registered_window_pids():
        if pid == current_pid:
            continue
        try:
            if sys.platform != "win32":
                os.killpg(pid, signal.SIGTERM)
            else:
                os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except Exception:
            LOGGER.exception("Failed to terminate window process %s", pid)
        finally:
            _unregister_window_pid(pid)


def _write_feedback_snapshot(payload: dict[str, Any]) -> None:
    path = _desktop_feedback_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _read_feedback_snapshot() -> dict[str, Any]:
    path = _desktop_feedback_file()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    owner_pid = payload.get("owner_pid")
    if isinstance(owner_pid, int) and owner_pid > 0 and not _pid_is_running(owner_pid):
        return {}
    return payload

if sys.platform == "darwin":
    try:
        from AppKit import (
            NSApp,
            NSApplication,
            NSApplicationActivationPolicyAccessory,
            NSApplicationActivationPolicyRegular,
            NSImage,
            NSMenu,
            NSMenuItem,
            NSStatusBar,
            NSVariableStatusItemLength,
        )
        from Foundation import NSData, NSObject
        import objc
    except Exception:  # pragma: no cover - optional macOS bridge
        NSApp = None
        NSApplication = None
        NSApplicationActivationPolicyAccessory = None
        NSApplicationActivationPolicyRegular = None
        NSImage = None
        NSMenu = None
        NSMenuItem = None
        NSStatusBar = None
        NSVariableStatusItemLength = None
        NSData = None
        NSObject = object
        objc = None
else:  # pragma: no cover - non-macOS platforms
    NSApp = None
    NSApplication = None
    NSApplicationActivationPolicyAccessory = None
    NSApplicationActivationPolicyRegular = None
    NSImage = None
    NSMenu = None
    NSMenuItem = None
    NSStatusBar = None
    NSVariableStatusItemLength = None
    NSData = None
    NSObject = object
    objc = None


if sys.platform == "darwin" and objc is not None:
    class _MacStatusBarDelegate(NSObject):
        def initWithController_(self, controller):
            self = objc.super(_MacStatusBarDelegate, self).init()
            if self is None:
                return None
            self._controller = controller
            return self

        def openSettings_(self, _sender) -> None:
            self._controller._on_tray_show_settings(None, None)

        def startRecording_(self, _sender) -> None:
            self._controller._on_tray_start_recording(None, None)

        def stopRecording_(self, _sender) -> None:
            self._controller._on_tray_stop_recording(None, None)

        def toggleLaunchAtLogin_(self, _sender) -> None:
            self._controller._on_tray_toggle_launch_at_login(None, None)

        def quitApp_(self, _sender) -> None:
            self._controller._on_tray_quit(None, None)


else:
    _MacStatusBarDelegate = None


class DesktopController:
    def __init__(self, *, window_only: bool = False) -> None:
        self._state_lock = threading.RLock()
        self._window_only = window_only
        self._settings = load_settings()
        self._settings.desktop.launch_at_login = launch_at_login_enabled()
        self._tray_icon: pystray.Icon | None = None
        self._status_item: Any | None = None
        self._macos_app: Any | None = None
        self._macos_status_delegate: Any | None = None
        self._page: ft.Page | None = None
        self._recorder = None
        self._recorder_thread: threading.Thread | None = None
        self._feedback_writer_thread: threading.Thread | None = None
        self._microphone_permission = microphone_permission_status()
        self._permission_request_in_flight = False
        self._launch_permission_prompt_attempted = False
        self._status_message = "托盘已启动，等待操作。"
        self._window_visible = False
        self._show_window_requested = False
        self._quitting = False
        self._ui_refresh_started = False
        self._controls: dict[str, Any] = {}
        self._status_badge: ft.Text | None = None
        self._status_subtitle: ft.Text | None = None
        self._record_button: ft.Button | None = None
        self._devices_hint: ft.Text | None = None
        self._microphone_permission_text: ft.Text | None = None
        self._request_permission_button: ft.OutlinedButton | None = None
        self._open_privacy_settings_button: ft.TextButton | None = None
        self._permission_summary_text: ft.Text | None = None
        self._permission_ok_row: ft.Row | None = None
        self._permission_detail_column: ft.Column | None = None
        self._live_monitor: LiveMonitorPanel | None = None
        self._waveform_monitor: DeviceWaveformMonitor | None = None

    def run(self) -> int:
        init_logging()
        if self._window_only:
            _register_window_pid(os.getpid())
            try:
                ft.run(
                    self._main,
                    name="eve",
                    view=ft.AppView.FLET_APP,
                    assets_dir=None,
                )
            finally:
                _unregister_window_pid(os.getpid())
                self._shutdown()
        elif sys.platform == "darwin" and _MacStatusBarDelegate is not None:
            self._start_feedback_writer()
            self._run_macos_tray()
        else:
            self._start_feedback_writer()
            self._tray_icon = self._create_tray_icon()
            self._tray_icon.run()
        return 0

    def _run_macos_tray(self) -> None:
        if (
            NSApplication is None
            or NSStatusBar is None
            or NSVariableStatusItemLength is None
            or _MacStatusBarDelegate is None
        ):
            raise RuntimeError("macOS tray support is unavailable in the current environment.")

        self._macos_app = NSApplication.sharedApplication()
        if (
            self._macos_app is not None
            and NSApplicationActivationPolicyAccessory is not None
        ):
            self._macos_app.setActivationPolicy_(
                NSApplicationActivationPolicyAccessory
            )

        self._macos_status_delegate = _MacStatusBarDelegate.alloc().initWithController_(
            self
        )
        self._status_item = NSStatusBar.systemStatusBar().statusItemWithLength_(
            NSVariableStatusItemLength
        )
        button = self._status_item.button()
        if button is not None:
            button.setToolTip_("eve")
            icon = self._build_macos_status_image()
            if icon is not None:
                button.setImage_(icon)
        self._refresh_macos_status_menu()
        self._maybe_request_microphone_permission_on_launch()

        if self._settings.desktop.start_recording_on_launch:
            self._start_recording()

        previous_sigint = signal.getsignal(signal.SIGINT)
        previous_sigterm = signal.getsignal(signal.SIGTERM)

        def _terminate_tray(_signum, _frame) -> None:
            LOGGER.info("Received termination signal for macOS tray.")
            if self._macos_app is not None:
                self._macos_app.terminate_(None)

        signal.signal(signal.SIGINT, _terminate_tray)
        signal.signal(signal.SIGTERM, _terminate_tray)

        try:
            self._macos_app.run()
        except KeyboardInterrupt:
            LOGGER.info("macOS tray interrupted, shutting down.")
        finally:
            signal.signal(signal.SIGINT, previous_sigint)
            signal.signal(signal.SIGTERM, previous_sigterm)
            self._shutdown()

    def _shutdown(self) -> None:
        self._quitting = True
        if self._waveform_monitor is not None:
            self._waveform_monitor.stop()
        self._stop_recording(join_timeout=2.0)
        if self._status_item is not None and NSStatusBar is not None:
            try:
                NSStatusBar.systemStatusBar().removeStatusItem_(self._status_item)
            except Exception:
                pass
            self._status_item = None
        self._macos_status_delegate = None
        if self._tray_icon is not None:
            try:
                self._tray_icon.stop()
            except Exception:
                pass
        self._tray_icon = None

    async def _main(self, page: ft.Page) -> None:
        self._page = page
        page.title = "eve"
        page.padding = 0
        page.spacing = 0
        page.bgcolor = "#F5F5F2"
        page.theme_mode = ft.ThemeMode.LIGHT
        page.window.width = 980
        page.window.height = 860
        page.window.min_width = 860
        page.window.min_height = 720
        page.window.resizable = True
        page.window.maximizable = False
        page.window.minimizable = True
        page.window.skip_task_bar = False if sys.platform == "darwin" else True
        page.window.visible = self._window_only
        page.window.prevent_close = True
        page.window.on_event = self._on_window_event
        page.pubsub.subscribe(self._handle_pubsub_message)

        self._ensure_waveform_monitor()
        self._build_page(page)
        await page.window.wait_until_ready_to_show()
        self._sync_status_widgets()
        self._refresh_live_feedback_controls()

        if self._window_only:
            self._window_visible = True
        elif self._show_window_requested:
            self._show_window_requested = False
            await self._show_window()

        self._maybe_request_microphone_permission_on_launch()

        if self._settings.desktop.start_recording_on_launch and not self._window_only:
            self._start_recording()

        if not self._ui_refresh_started:
            self._ui_refresh_started = True
            page.run_task(self._ui_refresh_loop)

        LOGGER.info("Desktop UI ready")

    def _build_page(self, page: ft.Page) -> None:
        header = ft.Container(
            bgcolor="#F8F8F6",
            padding=ft.Padding.only(left=32, right=32, top=32, bottom=20),
            content=ft.Row(
                alignment=ft.MainAxisAlignment.SPACE_BETWEEN,
                vertical_alignment=ft.CrossAxisAlignment.END,
                controls=[
                    ft.Column(
                        spacing=4,
                        controls=[
                            ft.Text(
                                "eve",
                                size=28,
                                weight=ft.FontWeight.W_800,
                                color="#1A1C1A",
                            ),
                            ft.Text(
                                "极简录音与转录工作流",
                                size=13,
                                color="#727773",
                                weight=ft.FontWeight.W_400,
                            ),
                        ],
                    ),
                    ft.Container(
                        padding=ft.Padding.symmetric(horizontal=12, vertical=6),
                        bgcolor="#E9E9E4",
                        border_radius=8,
                        content=ft.Text(
                            "DESKTOP CONSOLE",
                            size=10,
                            weight=ft.FontWeight.W_600,
                            color="#545955",

                        ),
                    ),
                ],
            ),
        )

        self._status_badge = ft.Text(
            value="IDLE",
            size=13,
            weight=ft.FontWeight.W_700,
            color="#4A524D",
        )
        self._status_subtitle = ft.Text(
            value=self._status_message,
            size=12,
            color="#727773",
        )
        self._record_button = ft.Button(
            content=ft.Text("开始录制", weight=ft.FontWeight.W_600),
            on_click=self._on_toggle_recording,
            style=ft.ButtonStyle(
                bgcolor="#1A1C1A",
                color="#F8F8F6",
                padding=ft.Padding.symmetric(horizontal=24, vertical=18),
                shape=ft.RoundedRectangleBorder(radius=12),
                elevation=0,
            ),
        )
        tabs = ft.Tabs(
            selected_index=0,
            animation_duration=200,
            length=4,
            expand=True,
            content=ft.Column(
                spacing=0,
                expand=True,
                controls=[
                    ft.TabBar(
                        divider_color="#E9E9E4",
                        indicator_color="#1A1C1A",
                        label_color="#1A1C1A",
                        unselected_label_color="#A3A8A4",
                        tabs=[
                            ft.Tab(label="概览"),
                            ft.Tab(label="基本"),
                            ft.Tab(label="设备"),
                            ft.Tab(label="模型"),
                        ],
                    ),
                    ft.Container(
                        expand=True,
                        padding=ft.Padding.only(top=16),
                        content=ft.TabBarView(
                            expand=True,
                            controls=[
                                self._build_overview_tab(),
                                self._build_basic_tab(),
                                self._build_device_tab_refined(),
                                self._build_models_tab(),
                            ],
                        ),
                    ),
                ],
            ),
        )

        page.add(
            ft.Column(
                spacing=0,
                expand=True,
                controls=[
                    header,
                    ft.Container(
                        expand=True,
                        padding=ft.Padding.only(left=32, right=32, top=16, bottom=32),
                        content=tabs,
                    ),
                    ft.Container(
                        padding=ft.Padding.only(left=32, right=32, bottom=28),
                        content=self._build_star_cta(),
                    ),
                ],
            )
        )
        self._configure_auto_save_controls()

    def _build_star_cta(self) -> ft.Control:
        return ft.Container(
            bgcolor="#F7F3EA",
            border=ft.Border.all(1, "#E4DCCF"),
            border_radius=18,
            padding=18,
            content=ft.ResponsiveRow(
                columns=12,
                run_spacing=12,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
                controls=[
                    ft.Container(
                        col={"xs": 12, "md": 8},
                        content=ft.Column(
                            spacing=4,
                            controls=[
                                ft.Row(
                                    spacing=8,
                                    controls=[
                                        ft.Icon(
                                            ft.Icons.STAR_ROUNDED,
                                            size=18,
                                            color="#9C6A1D",
                                        ),
                                        ft.Text(
                                            "喜欢 eve 的话，欢迎去 GitHub 点个 Star",
                                            size=14,
                                            weight=ft.FontWeight.W_700,
                                            color="#2A2926",
                                        ),
                                    ],
                                ),
                                ft.Text(
                                    "你的支持能帮助项目继续迭代，也能让更多人发现这个录音与转写工具。",
                                    size=12,
                                    color="#66615A",
                                ),
                            ],
                        ),
                    ),
                    ft.Container(
                        col={"xs": 12, "md": 4},
                        alignment=ft.Alignment(1, 0),
                        content=ft.Button(
                            content=ft.Row(
                                spacing=8,
                                tight=True,
                                controls=[
                                    ft.Icon(
                                        ft.Icons.OPEN_IN_NEW_ROUNDED,
                                        size=16,
                                        color="#F8F8F6",
                                    ),
                                    ft.Text(
                                        "去 GitHub Star",
                                        weight=ft.FontWeight.W_600,
                                        color="#F8F8F6",
                                    ),
                                ],
                            ),
                            on_click=self._on_open_github_star,
                            style=ft.ButtonStyle(
                                bgcolor="#1F2A24",
                                padding=ft.Padding.symmetric(horizontal=18, vertical=16),
                                shape=ft.RoundedRectangleBorder(radius=12),
                                elevation=0,
                            ),
                        ),
                    ),
                ],
            ),
        )

    def _build_overview_tab(self) -> ft.Control:
        permission_card = self._build_overview_permission_card()
        return ft.ListView(
            padding=ft.Padding.only(top=20),
            spacing=24,
            controls=[
                ft.Row(
                    alignment=ft.MainAxisAlignment.SPACE_BETWEEN,
                    controls=[
                        ft.Column(
                            spacing=4,
                            controls=[
                                self._status_badge,
                                self._status_subtitle,
                            ],
                        ),
                        ft.Row(
                            spacing=12,
                            controls=self._build_status_actions(),
                        ),
                    ],
                ),
                permission_card,
                ft.Container(
                    bgcolor="#FFFFFF",
                    border=ft.Border.all(1, "#E9E9E4"),
                    border_radius=20,
                    padding=24,
                    content=self._build_live_monitor(),
                ),
            ],
        )

    def _build_overview_permission_card(self) -> ft.Control:
        self._microphone_permission_text = ft.Text(
            value=self._microphone_permission.message,
            size=12,
            color="#727773",
        )
        self._request_permission_button = ft.OutlinedButton(
            content="申请录音权限",
            on_click=self._on_request_microphone_permission,
            style=ft.ButtonStyle(shape=ft.RoundedRectangleBorder(radius=8)),
            visible=self._microphone_permission.state == "not_determined",
        )
        self._open_privacy_settings_button = ft.TextButton(
            "打开系统隐私设置",
            on_click=self._on_open_microphone_settings,
            visible=self._microphone_permission.state in {"denied", "restricted"},
        )
        self._permission_summary_text = ft.Text(
            "已获得麦克风权限，可以正常录音。",
            size=13,
            color="#2F5B46",
            weight=ft.FontWeight.W_600,
        )
        self._permission_ok_row = ft.Row(
            spacing=10,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
            controls=[
                ft.Icon(ft.Icons.CHECK_CIRCLE_ROUNDED, size=18, color="#2F7A54"),
                self._permission_summary_text,
            ],
        )
        self._permission_detail_column = ft.Column(
            spacing=12,
            controls=[
                self._microphone_permission_text,
                ft.Row(
                    spacing=12,
                    wrap=True,
                    controls=[
                        self._request_permission_button,
                        self._open_privacy_settings_button,
                    ],
                ),
            ],
        )
        return ft.Container(
            bgcolor="#FFFFFF",
            border=ft.Border.all(1, "#E9E9E4"),
            border_radius=20,
            padding=24,
            content=ft.Column(
                spacing=14,
                controls=[
                    ft.Column(
                        spacing=4,
                        controls=[
                            ft.Text(
                                "麦克风权限",
                                size=16,
                                weight=ft.FontWeight.W_700,
                                color="#1F2A24",
                            ),
                            ft.Text(
                                "没有权限时无法录音；有权限时这里只保留一条状态信息。",
                                size=12,
                                color="#666D68",
                            ),
                        ],
                    ),
                    self._permission_ok_row,
                    self._permission_detail_column,
                ],
            ),
        )

    def _build_basic_tab(self) -> ft.Control:

        self._controls["desktop.launch_at_login"] = ft.Switch(
            label="开机后自动启动",
            value=self._settings.desktop.launch_at_login,
            active_color="#1A1C1A",
        )
        self._controls["desktop.start_recording_on_launch"] = ft.Switch(
            label="启动后立即开始录音",
            value=self._settings.desktop.start_recording_on_launch,
            active_color="#1A1C1A",
        )
        self._controls["desktop.hide_window_on_close"] = ft.Switch(
            label="关闭时仅隐藏至托盘",
            value=self._settings.desktop.hide_window_on_close,
            active_color="#1A1C1A",
        )
        self._controls["recording.output_dir"] = ft.TextField(
            label="输出目录",
            value=self._settings.recording.output_dir,
            border_color="#E9E9E4",
            cursor_color="#1A1C1A",
            focused_border_color="#1A1C1A",
            text_size=14,
        )
        self._controls["recording.audio_format"] = ft.Dropdown(
            label="音频格式",
            value=self._settings.recording.audio_format,
            options=[ft.dropdown.Option("flac"), ft.dropdown.Option("wav")],
            expand=True,
            border_color="#E9E9E4",
        )
        self._controls["recording.segment_minutes"] = ft.TextField(
            label="分段长度 (min)",
            value=str(self._settings.recording.segment_minutes),
            expand=True,
            border_color="#E9E9E4",
        )

        return self._settings_card_grid(
            self._settings_card(
                title="桌面行为",
                subtitle="这些设置决定应用什么时候启动，以及关闭窗口后是否继续在后台运行。",
                items=[
                    self._setting_item(
                        "开机后自动启动",
                        "开机登录后自动打开 eve。",
                        self._controls["desktop.launch_at_login"],
                    ),
                    self._setting_item(
                        "启动后立即开始录音",
                        "打开应用后马上开始录音，不用再手动点击。",
                        self._controls["desktop.start_recording_on_launch"],
                    ),
                    self._setting_item(
                        "关闭时仅隐藏至托盘",
                        "关闭窗口后继续在后台运行，录音不会中断。",
                        self._controls["desktop.hide_window_on_close"],
                    ),
                ],
            ),
            self._settings_card(
                title="存储与格式",
                subtitle="设置录音保存位置，以及每个音频文件的格式和时长。",
                items=[
                    self._setting_item(
                        "输出目录",
                        "录音和转写文件会保存到这里。",
                        self._controls["recording.output_dir"],
                    ),
                    self._setting_item(
                        "音频格式",
                        "选择保存为 `flac` 或 `wav`。",
                        self._controls["recording.audio_format"],
                    ),
                    self._setting_item(
                        "分段长度",
                        "每录到这个时长，就会自动新建一个文件。",
                        self._controls["recording.segment_minutes"],
                    ),
                ],
                col={"xs": 12},
            ),
        )

    def _build_device_tab_refined(self) -> ft.Control:
        advanced_device_fields = [
            ("recording.device_check_seconds", "健康检查间隔（秒）"),
            ("recording.auto_switch_scan_seconds", "自动切换扫描间隔（秒）"),
            ("recording.auto_switch_min_rms", "最小触发音量"),
        ]
        
        self._controls["recording.device"] = ft.TextField(
            label="主录音设备（编号或名称）",
            value=self._settings.recording.device,
            border_color="#E9E9E4",
        )
        self._controls["recording.auto_switch_device"] = ft.Switch(
            label="自动切换到当前活跃麦克风",
            value=self._coerce_auto_switch_value(self._settings.recording.auto_switch_device),
            active_color="#1A1C1A",
        )
        self._controls["recording.exclude_device_keywords"] = ft.TextField(
            label="忽略设备关键词（逗号分隔）",
            value=self._settings.recording.exclude_device_keywords,
            border_color="#E9E9E4",
        )

        advanced_row_controls = []
        for name, label in advanced_device_fields:
            self._controls[name] = ft.TextField(
                label=label,
                value=str(self._resolve_control_value(name)),
                expand=True,
                border_color="#E9E9E4",
            )
            advanced_row_controls.append(self._controls[name])

        self._devices_hint = ft.Text(
            value=self._format_input_devices(),
            size=12,
            color="#545955",
            font_family="monospace",
        )

        return self._settings_card_grid(
            self._settings_card(
                title="录音设备",
                subtitle="选择主要使用哪个麦克风，以及是否自动切换到有声音的设备。",
                items=[
                    self._setting_item(
                        "主录音设备",
                        "可以填设备编号或名称；不改的话会使用系统默认麦克风。",
                        self._controls["recording.device"],
                    ),
                    self._setting_item(
                        "自动切换到活跃麦克风",
                        "当其他麦克风开始有明显声音时，自动切过去录音。",
                        self._controls["recording.auto_switch_device"],
                    ),
                    self._setting_item(
                        "忽略设备关键词",
                        "包含这些关键词的设备不会被自动选中，多个词用逗号分隔。",
                        self._controls["recording.exclude_device_keywords"],
                    ),
                ],
            ),
            self._settings_card(
                title="探测参数",
                subtitle="只有在你想微调自动切换时，才需要改这里。",
                items=[
                    self._setting_item(
                        "健康检查间隔",
                        "每隔多久检查一次当前麦克风是否还能正常使用。",
                        advanced_row_controls[0],
                    ),
                    self._setting_item(
                        "扫描间隔",
                        "每隔多久重新看看有没有更合适的麦克风。",
                        advanced_row_controls[1],
                    ),
                    self._setting_item(
                        "最小触发音量",
                        "只有声音大于这个值，才会被当成有效输入。",
                        advanced_row_controls[2],
                    ),
                ],
            ),
            self._settings_card(
                title="系统设备列表",
                subtitle="这里会显示系统当前识别到的所有可用麦克风。",
                items=[
                    self._setting_info_item(
                        "已检测到的输入源",
                        "如果你刚插入新设备，可以点刷新重新读取。",
                        ft.Column(
                            spacing=12,
                            controls=[
                                ft.OutlinedButton(
                                    "刷新列表",
                                    on_click=self._on_refresh_devices,
                                    icon=ft.Icons.REFRESH_ROUNDED,
                                    style=ft.ButtonStyle(
                                        shape=ft.RoundedRectangleBorder(radius=10)
                                    ),
                                ),
                                ft.Container(
                                    padding=16,
                                    bgcolor="#F4F2ED",
                                    border=ft.Border.all(1, "#E6E1D8"),
                                    border_radius=14,
                                    content=self._devices_hint,
                                ),
                            ],
                        ),
                    )
                ],
                col={"xs": 12},
            ),
        )

    def _build_models_tab(self) -> ft.Control:
        self._controls["recording.disable_asr"] = ft.Switch(
            label="启用实时转写",
            value=not self._settings.recording.disable_asr,
            active_color="#1A1C1A",
        )
        self._controls["recording.asr_model"] = ft.TextField(
            label="实时转写模型",
            value=self._settings.recording.asr_model,
            border_color="#E9E9E4",
        )
        self._controls["recording.asr_device"] = ft.TextField(
            label="运行设备（auto/cpu/mps/cuda）",
            value=self._settings.recording.asr_device,
            expand=True,
            border_color="#E9E9E4",
        )
        self._controls["recording.asr_language"] = ft.TextField(
            label="语言",
            value=self._settings.recording.asr_language,
            expand=True,
            border_color="#E9E9E4",
        )
        self._controls["recording.asr_dtype"] = ft.Dropdown(
            label="运行精度",
            value=self._settings.recording.asr_dtype,
            options=[ft.dropdown.Option("auto"), ft.dropdown.Option("float16"), ft.dropdown.Option("float32")],
            expand=True,
            border_color="#E9E9E4",
        )
        self._controls["transcribe.input_dir"] = ft.TextField(
            label="历史录音目录",
            value=self._settings.transcribe.input_dir,
            border_color="#E9E9E4",
        )
        self._controls["transcribe.asr_model"] = ft.TextField(
            label="历史转写模型",
            value=self._settings.transcribe.asr_model,
            expand=2,
            border_color="#E9E9E4",
        )
        self._controls["transcribe.watch"] = ft.Switch(
            label="自动处理新文件",
            value=self._settings.transcribe.watch,
            active_color="#1A1C1A",
        )

        return self._settings_card_grid(
            self._settings_card(
                title="实时转写",
                subtitle="设置录音时是否同时转成文字，以及使用哪个模型。",
                items=[
                    self._setting_item(
                        "启用实时转写",
                        "录音时同步生成文字内容。",
                        self._controls["recording.disable_asr"],
                    ),
                    self._setting_item(
                        "实时转写模型",
                        "录音时使用这个模型来识别语音。",
                        self._controls["recording.asr_model"],
                    ),
                    self._setting_item(
                        "推理设备",
                        "决定转写优先用 CPU 还是可用的加速设备；一般保持 `auto` 即可。",
                        self._controls["recording.asr_device"],
                    ),
                    self._setting_item(
                        "语言",
                        "可以指定识别语言；不确定时保持默认即可。",
                        self._controls["recording.asr_language"],
                    ),
                    self._setting_item(
                        "运行精度",
                        "影响速度和占用；一般保持默认即可。",
                        self._controls["recording.asr_dtype"],
                    ),
                ],
            ),
            self._settings_card(
                title="历史录音转写",
                subtitle="用于处理已经录好的音频文件。",
                items=[
                    self._setting_item(
                        "历史录音目录",
                        "会从这个目录里查找还没转写的音频文件。",
                        self._controls["transcribe.input_dir"],
                    ),
                    self._setting_item(
                        "历史转写模型",
                        "处理历史录音时使用这个模型。",
                        self._controls["transcribe.asr_model"],
                    ),
                    self._setting_item(
                        "自动处理新文件",
                        "打开后，目录里有新音频文件时会自动开始转写。",
                        self._controls["transcribe.watch"],
                    ),
                ],
            ),
        )

    def _build_live_monitor(self) -> ft.Control:
        self._live_monitor = LiveMonitorPanel()
        return self._live_monitor.build()

    def _style_setting_control(self, control: ft.Control) -> ft.Control:
        if isinstance(control, ft.Switch):
            control.label = None
            control.active_color = "#295E4B"
            control.track_color = "#C7D4CB"
            control.inactive_track_color = "#D9DDD5"
            control.inactive_thumb_color = "#FFFFFF"
            return control
        if isinstance(control, ft.TextField):
            if control.label:
                control.hint_text = control.hint_text or control.label
                control.label = None
            control.border_color = "#DED8CD"
            control.focused_border_color = "#1F2A24"
            control.cursor_color = "#1F2A24"
            control.border_radius = 14
            control.content_padding = ft.Padding.symmetric(horizontal=14, vertical=14)
            control.text_size = 14
            control.dense = True
            return control
        if isinstance(control, ft.Dropdown):
            if control.label:
                control.hint_text = control.hint_text or control.label
                control.label = None
            control.border_color = "#DED8CD"
            control.focused_border_color = "#1F2A24"
            control.border_radius = 14
            control.content_padding = ft.Padding.symmetric(horizontal=14, vertical=12)
            control.text_size = 14
            control.dense = True
            return control
        return control

    def _setting_item(
        self,
        title: str,
        subtitle: str,
        control: ft.Control,
    ) -> ft.Container:
        styled_control = self._style_setting_control(control)
        right_content: ft.Control = styled_control
        if isinstance(styled_control, ft.Switch):
            right_content = ft.Container(
                alignment=ft.Alignment(1, 0),
                content=styled_control,
            )

        return ft.Container(
            bgcolor="#FFFFFF",
            border=ft.Border.all(1, "#ECE6DC"),
            border_radius=16,
            padding=16,
            content=ft.ResponsiveRow(
                columns=12,
                run_spacing=12,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
                controls=[
                    ft.Container(
                        col={"xs": 12, "md": 7},
                        content=ft.Column(
                            spacing=4,
                            controls=[
                                ft.Text(
                                    title,
                                    size=14,
                                    weight=ft.FontWeight.W_700,
                                    color="#1F2A24",
                                ),
                                ft.Text(subtitle, size=12, color="#5F6661"),
                            ],
                        ),
                    ),
                    ft.Container(
                        col={"xs": 12, "md": 5},
                        alignment=ft.Alignment(1, 0),
                        content=right_content,
                    ),
                ],
            ),
        )

    def _setting_info_item(
        self,
        title: str,
        subtitle: str,
        content: ft.Control,
    ) -> ft.Container:
        return ft.Container(
            bgcolor="#FFFFFF",
            border=ft.Border.all(1, "#ECE6DC"),
            border_radius=16,
            padding=16,
            content=ft.Column(
                spacing=12,
                controls=[
                    ft.Column(
                        spacing=4,
                        controls=[
                            ft.Text(
                                title,
                                size=14,
                                weight=ft.FontWeight.W_700,
                                color="#1F2A24",
                            ),
                            ft.Text(subtitle, size=12, color="#5F6661"),
                        ],
                    ),
                    content,
                ],
            ),
        )

    def _settings_card(
        self,
        *,
        title: str,
        subtitle: str,
        items: list[ft.Control],
        col: dict[str, int] | None = None,
    ) -> ft.Container:
        return ft.Container(
            col=col or {"xs": 12, "md": 6},
            content=self._settings_section(
                title=title,
                subtitle=subtitle,
                content=ft.Column(
                    spacing=12,
                    controls=items,
                ),
            ),
        )

    def _settings_card_grid(self, *cards: ft.Control) -> ft.ListView:
        return ft.ListView(
            padding=ft.Padding.only(top=20),
            spacing=0,
            controls=[
                ft.ResponsiveRow(
                    columns=12,
                    spacing=16,
                    run_spacing=16,
                    controls=list(cards),
                )
            ],
        )

    def _empty_feedback_payload(self) -> dict[str, Any]:
        return {
            "owner_pid": os.getpid(),
            "timestamp": time.time(),
            "recording": False,
            "elapsed": "00:00:00",
            "rms": 0.0,
            "db": -80.0,
            "level_ratio": 0.0,
            "in_speech": False,
            "device_label": "-",
            "auto_switch_enabled": self._coerce_auto_switch_value(
                self._settings.recording.auto_switch_device
            ),
            "asr_enabled": not self._settings.recording.disable_asr,
            "asr_preview": "",
            "asr_history": [],
            "waveform_bins": [0.0] * WAVEFORM_BIN_COUNT,
            "status_message": self._status_message,
        }

    def _build_feedback_payload(self) -> dict[str, Any]:
        payload = self._empty_feedback_payload()
        with self._state_lock:
            recorder = self._recorder
            thread = self._recorder_thread
            payload["recording"] = bool(thread is not None and thread.is_alive())
            payload["status_message"] = self._status_message
        if recorder is None or not hasattr(recorder, "feedback_snapshot"):
            return payload
        try:
            snapshot = recorder.feedback_snapshot()
        except Exception as exc:
            LOGGER.debug("Failed to read recorder feedback snapshot: %s", exc)
            return payload
        payload.update(
            {
                "elapsed": getattr(snapshot, "elapsed", payload["elapsed"]),
                "rms": float(getattr(snapshot, "rms", payload["rms"])),
                "db": float(getattr(snapshot, "db", payload["db"])),
                "level_ratio": float(
                    getattr(snapshot, "level_ratio", payload["level_ratio"])
                ),
                "in_speech": bool(
                    getattr(snapshot, "in_speech", payload["in_speech"])
                ),
                "device_label": str(
                    getattr(snapshot, "device_label", payload["device_label"])
                ),
                "auto_switch_enabled": bool(
                    getattr(
                        snapshot,
                        "auto_switch_enabled",
                        payload["auto_switch_enabled"],
                    )
                ),
                "asr_enabled": bool(
                    getattr(snapshot, "asr_enabled", payload["asr_enabled"])
                ),
                "asr_preview": str(
                    getattr(snapshot, "asr_preview", payload["asr_preview"])
                ),
                "asr_history": list(
                    getattr(snapshot, "asr_history", payload["asr_history"])
                ),
                "waveform_bins": list(
                    getattr(snapshot, "waveform_bins", payload["waveform_bins"])
                ),
            }
        )
        payload["timestamp"] = time.time()
        return payload

    def _start_feedback_writer(self) -> None:
        thread = self._feedback_writer_thread
        if thread is not None and thread.is_alive():
            return
        thread = threading.Thread(
            target=self._feedback_writer_loop,
            daemon=True,
            name="eve-desktop-feedback",
        )
        self._feedback_writer_thread = thread
        thread.start()

    def _feedback_writer_loop(self) -> None:
        last_serialized = ""
        while not self._quitting:
            try:
                self._process_external_commands()
                payload = self._build_feedback_payload()
                serialized = json.dumps(
                    payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                )
                if serialized != last_serialized:
                    _write_feedback_snapshot(payload)
                    last_serialized = serialized
            except Exception as exc:
                LOGGER.debug("Failed to write recorder feedback snapshot: %s", exc)
            time.sleep(0.12)
        try:
            _write_feedback_snapshot(self._empty_feedback_payload())
        except Exception:
            LOGGER.debug("Failed to write final idle feedback snapshot.", exc_info=True)

    def _read_live_feedback_payload(self) -> dict[str, Any]:
        payload = self._build_feedback_payload()
        recorder_bins = [
            max(0.0, min(1.0, float(value)))
            for value in payload.get("waveform_bins", [])
        ]
        recorder_has_waveform = max(recorder_bins, default=0.0) > 0.035
        preview = self._read_waveform_preview_payload()
        preview_bins = [
            max(0.0, min(1.0, float(value)))
            for value in preview.get("waveform_bins", [])
        ]
        preview_available = bool(preview.get("available"))
        preview_has_waveform = max(preview_bins, default=0.0) > 0.035
        if payload.get("recording"):
            if preview_available:
                payload["db"] = preview["db"]
                payload["device_label"] = preview["device_label"]
                payload["waveform_bins"] = preview_bins
                payload["waveform_active"] = preview_has_waveform
            else:
                payload["waveform_bins"] = recorder_bins
                payload["waveform_active"] = recorder_has_waveform
            payload["waveform_processing"] = False
            return payload
        if not payload.get("recording") and self._recorder is None:
            external_payload = _read_feedback_snapshot()
            if external_payload:
                timestamp = external_payload.get("timestamp")
                if not (
                    isinstance(timestamp, (int, float))
                    and time.time() - float(timestamp) > 2.0
                ):
                    payload.update(external_payload)
        if preview_available:
            payload["db"] = preview["db"]
            payload["device_label"] = preview["device_label"]
            payload["waveform_bins"] = preview_bins
            payload["waveform_active"] = preview_has_waveform
        else:
            payload["waveform_active"] = False
        payload["waveform_processing"] = False
        return payload

    def _read_waveform_preview_payload(self) -> dict[str, Any]:
        monitor = self._waveform_monitor
        if monitor is None:
            return {
                "db": -80.0,
                "device_label": "-",
                "waveform_bins": [0.0] * WAVEFORM_BIN_COUNT,
                "active": False,
                "available": False,
            }
        snapshot = monitor.snapshot()
        return {
            "db": snapshot.db,
            "device_label": snapshot.device_label,
            "waveform_bins": snapshot.waveform_bins,
            "active": snapshot.active,
            "available": snapshot.available,
        }

    def _refresh_live_feedback_controls(self) -> None:
        if self._page is None or self._live_monitor is None:
            return
        payload = self._read_live_feedback_payload()
        self._live_monitor.apply_payload(payload)
        try:
            self._live_monitor.update()
        except RuntimeError:
            return

    async def _ui_refresh_loop(self) -> None:
        while not self._quitting:
            try:
                self._sync_status_widgets()
                self._refresh_live_feedback_controls()
            except Exception as exc:
                LOGGER.debug("Failed to refresh desktop live monitor: %s", exc)
            await asyncio.sleep(1 / 30)

    def _card(self, *, title: str, subtitle: str, content: ft.Control) -> ft.Container:
        return ft.Container(
            bgcolor="#FBFBF8",
            border=ft.Border.all(1, "#E4E1DA"),
            border_radius=18,
            padding=18,
            content=ft.Column(
                spacing=14,
                controls=[
                    ft.Column(
                        spacing=3,
                        controls=[
                            ft.Text(
                                title,
                                size=16,
                                weight=ft.FontWeight.W_600,
                                color="#1F2A24",
                            ),
                            ft.Text(subtitle, size=12, color="#5B625D"),
                        ],
                    ),
                    content,
                ],
            ),
        )

    def _settings_section(
        self, *, title: str, subtitle: str, content: ft.Control
    ) -> ft.Control:
        return self._card(
            title=title,
            subtitle=subtitle,
            content=content,
        )

    async def _handle_pubsub_message(self, message: Any) -> None:
        if not isinstance(message, dict):
            return
        kind = message.get("kind")
        LOGGER.info("Handling desktop message: %s", kind)
        if kind == "show-settings":
            await self._show_window()
        elif kind == "hide-settings":
            await self._hide_window()
        elif kind == "sync-state":
            maybe_message = message.get("message")
            if isinstance(maybe_message, str) and maybe_message.strip():
                self._status_message = maybe_message.strip()
            self._sync_status_widgets()
        elif kind == "exit-app":
            await self._exit_app()

    async def _on_window_event(self, event: ft.WindowEvent) -> None:
        if event.type != ft.WindowEventType.CLOSE:
            return
        if self._window_only:
            await self._exit_app()
        elif self._settings.desktop.hide_window_on_close:
            await self._hide_window()
        else:
            await self._exit_app()

    async def _show_window(self) -> None:
        if self._page is None:
            return
        LOGGER.info("Showing settings window")
        print("Showing settings window")
        self._window_visible = True
        self._page.window.skip_task_bar = False
        self._page.window.visible = True
        self._page.update()
        if self._window_only:
            return
        self._activate_macos_app()
        await self._page.window.to_front()
        self._page.window.focused = True
        self._page.update()
        LOGGER.info("Settings window focused")

    async def _hide_window(self) -> None:
        if self._page is None:
            return
        self._window_visible = False
        self._page.window.visible = False
        self._page.update()

    async def _exit_app(self) -> None:
        if self._page is None:
            return
        self._quitting = True
        if self._waveform_monitor is not None:
            self._waveform_monitor.stop()
        self._stop_recording(join_timeout=2.0)
        if self._status_item is not None and NSStatusBar is not None:
            NSStatusBar.systemStatusBar().removeStatusItem_(self._status_item)
            self._status_item = None
        if self._tray_icon is not None:
            self._tray_icon.stop()
        await self._page.window.destroy()

    def _on_toggle_recording(self, _event) -> None:
        if self._effective_recording_state():
            self._stop_recording()
        else:
            self._start_recording()

    def _save_settings_from_controls(self) -> None:
        settings = self._collect_settings_from_controls()
        if self._window_only and ipc_desktop_controller_available():
            save_settings(settings)
            self._settings = settings
            self._ensure_waveform_monitor()
            self._waveform_monitor.set_device(settings.recording.device)
            if self._dispatch_to_tray("reload-settings"):
                self._status_message = f"设置已发送到托盘并保存到 {settings_file()}"
                self._publish({"kind": "sync-state"})
                return
        self._apply_settings(settings)

    def _on_save_settings(self, _event=None) -> None:
        try:
            self._save_settings_from_controls()
        except Exception as exc:
            LOGGER.exception("Failed to save desktop settings: %s", exc)
            self._status_message = f"保存失败：{exc}"
            self._publish({"kind": "sync-state"})

    def _on_request_microphone_permission(self, _event) -> None:
        self._request_microphone_permission_async(start_recording_after=False)

    def _on_open_microphone_settings(self, _event) -> None:
        if open_microphone_privacy_settings():
            self._status_message = "已打开系统设置，请在“隐私与安全性 > 麦克风”里允许 eve。"
        else:
            self._status_message = "无法自动打开系统设置，请手动前往“隐私与安全性 > 麦克风”。"
        self._publish({"kind": "sync-state"})

    def _on_open_github_star(self, _event) -> None:
        opened = webbrowser.open(GITHUB_REPO_URL)
        self._status_message = (
            "已打开 GitHub 仓库页面，感谢你的 Star 支持。"
            if opened
            else f"请手动打开 {GITHUB_REPO_URL}"
        )
        self._publish({"kind": "sync-state"})

    def _on_hide_window(self, _event) -> None:
        self._publish({"kind": "hide-settings"})

    def _on_exit_requested(self, _event) -> None:
        self._publish({"kind": "exit-app"})

    def _on_refresh_devices(self, _event) -> None:
        if self._devices_hint is None:
            return
        self._microphone_permission = microphone_permission_status()
        self._devices_hint.value = self._format_input_devices()
        self._publish({"kind": "sync-state"})

    def _collect_settings_from_controls(self) -> AppSettings:
        existing = deepcopy(self._settings)
        recording = RecordingSettings(
            device=self._read_text("recording.device", existing.recording.device),
            output_dir=self._read_text(
                "recording.output_dir", existing.recording.output_dir
            ),
            audio_format=self._read_choice(
                "recording.audio_format", existing.recording.audio_format
            ),
            device_check_seconds=self._read_float(
                "recording.device_check_seconds",
                existing.recording.device_check_seconds,
            ),
            device_retry_seconds=self._read_float(
                "recording.device_retry_seconds",
                existing.recording.device_retry_seconds,
            ),
            auto_switch_device=self._read_bool(
                "recording.auto_switch_device", existing.recording.auto_switch_device
            ),
            auto_switch_scan_seconds=self._read_float(
                "recording.auto_switch_scan_seconds",
                existing.recording.auto_switch_scan_seconds,
            ),
            auto_switch_probe_seconds=self._read_float(
                "recording.auto_switch_probe_seconds",
                existing.recording.auto_switch_probe_seconds,
            ),
            auto_switch_max_candidates_per_scan=self._read_int(
                "recording.auto_switch_max_candidates_per_scan",
                existing.recording.auto_switch_max_candidates_per_scan,
            ),
            exclude_device_keywords=self._read_text(
                "recording.exclude_device_keywords",
                existing.recording.exclude_device_keywords,
            ),
            auto_switch_min_rms=self._read_float(
                "recording.auto_switch_min_rms",
                existing.recording.auto_switch_min_rms,
            ),
            auto_switch_min_ratio=self._read_float(
                "recording.auto_switch_min_ratio",
                existing.recording.auto_switch_min_ratio,
            ),
            auto_switch_cooldown_seconds=self._read_float(
                "recording.auto_switch_cooldown_seconds",
                existing.recording.auto_switch_cooldown_seconds,
            ),
            auto_switch_confirmations=self._read_int(
                "recording.auto_switch_confirmations",
                existing.recording.auto_switch_confirmations,
            ),
            console_feedback=self._read_bool(
                "recording.console_feedback", existing.recording.console_feedback
            ),
            console_feedback_hz=self._read_float(
                "recording.console_feedback_hz",
                existing.recording.console_feedback_hz,
            ),
            total_hours=self._read_float(
                "recording.total_hours", existing.recording.total_hours
            ),
            segment_minutes=self._read_float(
                "recording.segment_minutes", existing.recording.segment_minutes
            ),
            asr_model=self._read_text("recording.asr_model", existing.recording.asr_model),
            disable_asr=not self._read_bool(
                "recording.disable_asr", not existing.recording.disable_asr
            ),
            asr_language=self._read_text(
                "recording.asr_language", existing.recording.asr_language
            ),
            asr_device=self._read_text(
                "recording.asr_device", existing.recording.asr_device
            ),
            asr_dtype=self._read_choice("recording.asr_dtype", existing.recording.asr_dtype),
            asr_max_new_tokens=self._read_int(
                "recording.asr_max_new_tokens",
                existing.recording.asr_max_new_tokens,
            ),
            asr_max_batch_size=self._read_int(
                "recording.asr_max_batch_size",
                existing.recording.asr_max_batch_size,
            ),
            asr_preload=self._read_bool("recording.asr_preload", existing.recording.asr_preload),
        )
        transcribe = TranscribeSettings(
            input_dir=self._read_text("transcribe.input_dir", existing.transcribe.input_dir),
            prefix=self._read_text("transcribe.prefix", existing.transcribe.prefix),
            watch=self._read_bool("transcribe.watch", existing.transcribe.watch),
            poll_seconds=self._read_float(
                "transcribe.poll_seconds", existing.transcribe.poll_seconds
            ),
            settle_seconds=self._read_float(
                "transcribe.settle_seconds", existing.transcribe.settle_seconds
            ),
            force=self._read_bool("transcribe.force", existing.transcribe.force),
            limit=self._read_int("transcribe.limit", existing.transcribe.limit),
            asr_model=self._read_text("transcribe.asr_model", existing.transcribe.asr_model),
            asr_language=self._read_text(
                "transcribe.asr_language", existing.transcribe.asr_language
            ),
            asr_device=self._read_text("transcribe.asr_device", existing.transcribe.asr_device),
            asr_dtype=self._read_choice("transcribe.asr_dtype", existing.transcribe.asr_dtype),
            asr_max_new_tokens=self._read_int(
                "transcribe.asr_max_new_tokens",
                existing.transcribe.asr_max_new_tokens,
            ),
            asr_max_batch_size=self._read_int(
                "transcribe.asr_max_batch_size",
                existing.transcribe.asr_max_batch_size,
            ),
            asr_preload=self._read_bool("transcribe.asr_preload", existing.transcribe.asr_preload),
        )
        desktop = DesktopSettings(
            launch_at_login=self._read_bool(
                "desktop.launch_at_login", existing.desktop.launch_at_login
            ),
            start_recording_on_launch=self._read_bool(
                "desktop.start_recording_on_launch",
                existing.desktop.start_recording_on_launch,
            ),
            hide_window_on_close=self._read_bool(
                "desktop.hide_window_on_close", existing.desktop.hide_window_on_close
            ),
        )
        return AppSettings(recording=recording, transcribe=transcribe, desktop=desktop)

    def _read_text(self, name: str, default: str) -> str:
        control = self._controls.get(name)
        if control is None:
            return default
        value = getattr(control, "value", None)
        if value is None:
            return default
        text = str(value).strip()
        return text or default

    def _read_choice(self, name: str, default: str) -> str:
        return self._read_text(name, default)

    def _read_float(self, name: str, default: float) -> float:
        raw = self._read_text(name, str(default))
        try:
            return float(raw)
        except ValueError:
            return default

    def _read_int(self, name: str, default: int) -> int:
        raw = self._read_text(name, str(default))
        try:
            return int(raw)
        except ValueError:
            return default

    def _read_bool(self, name: str, default: bool = False) -> bool:
        control = self._controls.get(name)
        if control is None:
            return default
        return bool(getattr(control, "value", default))

    def _configure_auto_save_controls(self) -> None:
        for control in self._controls.values():
            if isinstance(control, ft.TextField):
                control.on_blur = self._on_auto_save_triggered
                control.on_submit = self._on_auto_save_triggered
            elif isinstance(control, ft.Dropdown):
                control.on_select = self._on_auto_save_triggered
                control.on_blur = self._on_auto_save_triggered
            elif isinstance(control, ft.Switch):
                control.on_change = self._on_auto_save_triggered

    def _on_auto_save_triggered(self, _event) -> None:
        self._on_save_settings()

    def _resolve_control_value(self, name: str) -> Any:
        group_name, field_name = name.split(".", 1)
        group = getattr(self._settings, group_name)
        return getattr(group, field_name)

    def _asr_runtime_settings_changed(
        self, previous: RecordingSettings, current: RecordingSettings
    ) -> bool:
        return any(
            getattr(previous, field) != getattr(current, field)
            for field in (
                "disable_asr",
                "asr_model",
                "asr_language",
                "asr_device",
                "asr_dtype",
                "asr_max_new_tokens",
                "asr_max_batch_size",
                "asr_preload",
            )
        )

    def _recording_restart_required(
        self, previous: RecordingSettings, current: RecordingSettings
    ) -> bool:
        return any(
            getattr(previous, field) != getattr(current, field)
            for field in ("device",)
        )

    def _build_runtime_transcriber(self, recording_settings: RecordingSettings):
        return build_transcriber(SimpleNamespace(**asdict(recording_settings)))

    def _effective_recording_state(self) -> bool:
        if self._is_recording():
            return True
        if self._window_only:
            return bool(self._read_live_feedback_payload().get("recording"))
        return False

    def _effective_status_message(self) -> str:
        if not self._window_only:
            return self._status_message
        message = self._read_live_feedback_payload().get("status_message")
        if isinstance(message, str) and message.strip():
            return message.strip()
        return self._status_message

    def _dispatch_to_tray(self, kind: str) -> bool:
        if not self._window_only or not ipc_desktop_controller_available():
            return False
        try:
            ipc_enqueue_command(kind)
        except Exception as exc:
            LOGGER.exception("Failed to send desktop command %s: %s", kind, exc)
            self._status_message = f"发送托盘命令失败：{exc}"
            self._publish({"kind": "sync-state"})
            return False
        return True

    def _apply_settings(self, settings: AppSettings, *, already_saved: bool = False) -> None:
        was_recording = self._is_recording()
        previous_settings = self._settings
        restart_required = self._recording_restart_required(
            previous_settings.recording, settings.recording
        )
        asr_changed = self._asr_runtime_settings_changed(
            previous_settings.recording, settings.recording
        )
        next_transcriber = None
        if (
            was_recording
            and not restart_required
            and asr_changed
            and not settings.recording.disable_asr
        ):
            next_transcriber = self._build_runtime_transcriber(settings.recording)
        if not already_saved:
            save_settings(settings)
        set_launch_at_login(settings.desktop.launch_at_login)
        self._settings = settings
        self._ensure_waveform_monitor()
        self._waveform_monitor.set_device(settings.recording.device)
        self._status_message = f"设置已自动保存到 {settings_file()}"
        if was_recording:
            with self._state_lock:
                recorder = self._recorder
            if restart_required or recorder is None:
                self._stop_recording(join_timeout=2.0)
                self._start_recording()
            else:
                if hasattr(recorder, "apply_runtime_settings"):
                    recorder.apply_runtime_settings(deepcopy(settings.recording))
                if asr_changed:
                    if settings.recording.disable_asr:
                        if hasattr(recorder, "disable_live_asr"):
                            recorder.disable_live_asr()
                    elif hasattr(recorder, "enable_live_asr"):
                        recorder.enable_live_asr(next_transcriber)
                self._publish({"kind": "sync-state"})
        else:
            self._publish({"kind": "sync-state"})

    def _process_external_commands(self) -> None:
        if self._window_only:
            return
        for command in ipc_consume_commands():
            kind = command.get("kind")
            if kind == "start-recording":
                self._start_recording()
            elif kind == "stop-recording":
                self._stop_recording()
            elif kind == "reload-settings":
                self._apply_settings(load_settings(), already_saved=True)

    def _is_recording(self) -> bool:
        thread = self._recorder_thread
        return thread is not None and thread.is_alive()

    def _start_recording(self) -> None:
        if self._window_only and self._dispatch_to_tray("start-recording"):
            self._status_message = "已请求托盘开始录音。"
            self._publish({"kind": "sync-state"})
            return
        permission = microphone_permission_status()
        self._microphone_permission = permission
        if permission.state == "not_determined":
            self._status_message = "正在请求麦克风权限，请在系统弹窗里点击允许。"
            self._publish({"kind": "sync-state"})
            self._request_microphone_permission_async(start_recording_after=True)
            return
        if permission.state in {"denied", "restricted"}:
            self._status_message = permission.message
            self._publish({"kind": "sync-state"})
            return
        with self._state_lock:
            if self._is_recording():
                self._status_message = "录音已经在运行。"
                self._publish({"kind": "sync-state"})
                return
            self._status_message = "正在启动录音线程..."
            self._recorder = None
            thread = threading.Thread(
                target=self._run_recorder_worker,
                args=(deepcopy(self._settings.recording),),
                daemon=True,
                name="eve-desktop-recorder",
            )
            self._recorder_thread = thread
            thread.start()
        self._publish({"kind": "sync-state"})

    def _request_microphone_permission_async(self, *, start_recording_after: bool) -> None:
        with self._state_lock:
            if self._permission_request_in_flight:
                self._status_message = "录音权限申请正在进行中，请先处理系统弹窗。"
                self._publish({"kind": "sync-state"})
                return
            self._permission_request_in_flight = True
        self._publish({"kind": "sync-state"})
        thread = threading.Thread(
            target=self._request_microphone_permission_worker,
            args=(start_recording_after,),
            daemon=True,
            name="eve-microphone-permission",
        )
        thread.start()

    def _maybe_request_microphone_permission_on_launch(self) -> None:
        if sys.platform != "darwin" or self._settings.desktop.start_recording_on_launch:
            return
        with self._state_lock:
            if self._launch_permission_prompt_attempted or self._permission_request_in_flight:
                return
            permission = microphone_permission_status()
            self._microphone_permission = permission
            if permission.state != "not_determined":
                return
            self._launch_permission_prompt_attempted = True
            self._status_message = "正在主动申请麦克风权限，请在系统弹窗里点击允许。"
        self._activate_macos_for_permission_prompt()
        self._publish({"kind": "sync-state"})
        self._request_microphone_permission_async(start_recording_after=False)

    def _request_microphone_permission_worker(self, start_recording_after: bool) -> None:
        try:
            permission = request_microphone_permission()
            self._microphone_permission = permission
            if permission.state == "authorized":
                self._status_message = "麦克风权限已授权。"
                self._publish({"kind": "sync-state"})
                if start_recording_after:
                    self._start_recording()
                return
            if permission.state == "denied":
                self._status_message = "麦克风权限被拒绝，请到系统设置中手动开启。"
            elif permission.state == "restricted":
                self._status_message = "麦克风权限受系统限制，当前无法申请。"
            else:
                self._status_message = permission.message
            self._publish({"kind": "sync-state"})
        finally:
            with self._state_lock:
                self._permission_request_in_flight = False
            self._publish({"kind": "sync-state"})

    def _run_recorder_worker(self, recording_settings: RecordingSettings) -> None:
        exit_message = "录音已停止。"
        recorder = None
        try:
            recorder = create_live_recorder(
                SimpleNamespace(**asdict(recording_settings))
            )
            with self._state_lock:
                self._recorder = recorder
                self._status_message = "录音已启动。"
            self._refresh_tray_menu()
            self._publish({"kind": "sync-state"})
            recorder.start()
        except Exception as exc:
            LOGGER.exception("Recorder thread crashed: %s", exc)
            exit_message = f"录音线程异常退出：{exc}"
        finally:
            with self._state_lock:
                if self._recorder is recorder:
                    self._recorder = None
                    self._recorder_thread = None
                self._status_message = exit_message
            self._refresh_tray_menu()
            self._publish({"kind": "sync-state"})

    def _stop_recording(self, join_timeout: float = 5.0) -> None:
        if self._window_only and self._dispatch_to_tray("stop-recording"):
            self._status_message = "已请求托盘停止录音。"
            self._publish({"kind": "sync-state"})
            return
        with self._state_lock:
            recorder = self._recorder
            thread = self._recorder_thread
            if recorder is None:
                if thread is not None and thread.is_alive():
                    self._status_message = "录音线程仍在初始化，请稍后再试。"
                else:
                    self._status_message = "当前没有正在运行的录音线程。"
                self._publish({"kind": "sync-state"})
                return
            self._status_message = "正在停止录音线程..."
        try:
            recorder.stop()
        except Exception as exc:
            LOGGER.exception("Failed to stop recorder: %s", exc)
            self._status_message = f"停止录音失败：{exc}"
        if thread is not None and thread.is_alive():
            thread.join(timeout=join_timeout)
        with self._state_lock:
            self._recorder = None
            self._recorder_thread = None
            if not self._status_message.startswith("停止录音失败"):
                self._status_message = "录音已停止。"
        self._refresh_tray_menu()
        self._publish({"kind": "sync-state"})

    def _build_status_actions(self) -> list[ft.Control]:
        actions: list[ft.Control] = []
        if self._record_button is not None:
            actions.append(self._record_button)
        if not self._window_only:
            actions.append(ft.TextButton("隐藏窗口", on_click=self._on_hide_window))
            actions.append(ft.TextButton("退出", on_click=self._on_exit_requested))
        else:
            actions.append(ft.TextButton("关闭窗口", on_click=self._on_exit_requested))
        return actions

    def _format_microphone_permission_summary(
        self, permission: PermissionStatus
    ) -> str:
        mapping = {
            "authorized": "麦克风权限：已授权。",
            "not_determined": "麦克风权限：待授权。",
            "denied": "麦克风权限：已拒绝。",
            "restricted": "麦克风权限：受限制。",
            "unsupported": "麦克风权限：当前环境未接入检测。",
        }
        return mapping.get(permission.state, permission.message)

    def _sync_status_widgets(self) -> None:
        self._microphone_permission = microphone_permission_status()
        is_recording = self._effective_recording_state()
        status_message = self._effective_status_message()
        if self._status_badge is not None:
            self._status_badge.value = "RECORDING" if is_recording else "IDLE"
            self._status_badge.color = "#A33F2F" if is_recording else "#4A524D"
        if self._status_subtitle is not None:
            suffix = "Auto-start enabled" if self._settings.desktop.launch_at_login else "Auto-start disabled"
            self._status_subtitle.value = f"{status_message} ({suffix})"
        if self._record_button is not None:
            btn_text = ft.Text("停止录制" if is_recording else "开始录制")
            btn_text.weight = ft.FontWeight.W_600
            self._record_button.content = btn_text
            self._record_button.style = ft.ButtonStyle(
                bgcolor="#A33F2F" if is_recording else "#1A1C1A",
                color="#F8F8F6",
                padding=ft.Padding.symmetric(horizontal=24, vertical=18),
                shape=ft.RoundedRectangleBorder(radius=12),
                elevation=0,
            )
            self._record_button.disabled = self._permission_request_in_flight
        if self._microphone_permission_text is not None:
            self._microphone_permission_text.value = self._microphone_permission.message
        if self._request_permission_button is not None:
            self._request_permission_button.visible = (
                self._microphone_permission.state == "not_determined"
            )
            self._request_permission_button.disabled = self._permission_request_in_flight
        if self._open_privacy_settings_button is not None:
            self._open_privacy_settings_button.visible = (
                self._microphone_permission.state in {"denied", "restricted"}
            )
        has_permission = self._microphone_permission.state == "authorized"
        if self._permission_ok_row is not None:
            self._permission_ok_row.visible = has_permission
        if self._permission_detail_column is not None:
            self._permission_detail_column.visible = not has_permission
        if self._permission_summary_text is not None:
            self._permission_summary_text.value = (
                "已获得麦克风权限，可以正常录音。"
                if has_permission
                else "还没有麦克风权限。"
            )
        for control in (
            self._status_badge,
            self._status_subtitle,
            self._record_button,
            self._microphone_permission_text,
            self._request_permission_button,
            self._open_privacy_settings_button,
            self._permission_summary_text,
            self._permission_ok_row,
            self._permission_detail_column,
        ):
            if control is None:
                continue
            try:
                control.update()
            except RuntimeError:
                continue
        self._refresh_tray_menu()

    def _ensure_waveform_monitor(self) -> None:
        if self._waveform_monitor is None:
            self._waveform_monitor = DeviceWaveformMonitor(self._settings.recording.device)
            self._waveform_monitor.start()
            return
        self._waveform_monitor.set_device(self._settings.recording.device)

    def _publish(self, message: dict[str, Any]) -> None:
        if self._page is None:
            if message.get("kind") == "show-settings":
                self._show_window_requested = True
                print("Queued show-settings until page is ready")
            return
        try:
            self._page.pubsub.send_all(dict(message))
        except RuntimeError:
            return

    def _create_tray_icon(self) -> pystray.Icon:
        menu = pystray.Menu(
            pystray.MenuItem(
                "打开设置",
                self._on_tray_show_settings,
                default=True if sys.platform == "darwin" else pystray.Icon.HAS_DEFAULT_ACTION,
            ),
            pystray.MenuItem(
                "开始录音",
                self._on_tray_start_recording,
                visible=lambda item: not self._is_recording(),
            ),
            pystray.MenuItem(
                "停止录音",
                self._on_tray_stop_recording,
                visible=lambda item: self._is_recording(),
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                "开机自启",
                self._on_tray_toggle_launch_at_login,
                checked=lambda item: self._settings.desktop.launch_at_login,
            ),
            pystray.MenuItem("退出", self._on_tray_quit),
        )
        return pystray.Icon(
            "eve",
            icon=self._build_tray_image(),
            title="eve",
            menu=menu,
        )

    def _build_tray_image(self) -> Image.Image:
        image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((6, 6, 58, 58), radius=18, fill="#244B3C")
        draw.ellipse((16, 16, 28, 28), fill="#FFF6E9")
        draw.ellipse((36, 16, 48, 28), fill="#FFF6E9")
        draw.rounded_rectangle((14, 36, 50, 44), radius=4, fill="#F6B26B")
        return image

    def _refresh_tray_menu(self) -> None:
        if sys.platform == "darwin" and self._status_item is not None:
            self._refresh_macos_status_menu()
            return
        if self._tray_icon is not None:
            self._tray_icon.update_menu()

    def _build_macos_status_image(self):
        if NSImage is None or NSData is None:
            return None
        image = self._build_tray_image().resize((18, 18))
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        data = buffer.getvalue()
        ns_data = NSData.dataWithBytes_length_(data, len(data))
        return NSImage.alloc().initWithData_(ns_data)

    def _refresh_macos_status_menu(self) -> None:
        if (
            sys.platform != "darwin"
            or self._status_item is None
            or self._macos_status_delegate is None
            or NSMenu is None
            or NSMenuItem is None
        ):
            return
        menu = NSMenu.alloc().init()

        open_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "打开设置", "openSettings:", ""
        )
        open_item.setTarget_(self._macos_status_delegate)
        menu.addItem_(open_item)

        if self._is_recording():
            record_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
                "停止录音", "stopRecording:", ""
            )
        else:
            record_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
                "开始录音", "startRecording:", ""
            )
        record_item.setTarget_(self._macos_status_delegate)
        menu.addItem_(record_item)

        menu.addItem_(NSMenuItem.separatorItem())

        launch_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "开机自启", "toggleLaunchAtLogin:", ""
        )
        launch_item.setTarget_(self._macos_status_delegate)
        launch_item.setState_(1 if self._settings.desktop.launch_at_login else 0)
        menu.addItem_(launch_item)

        quit_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "退出", "quitApp:", ""
        )
        quit_item.setTarget_(self._macos_status_delegate)
        menu.addItem_(quit_item)

        self._status_item.setMenu_(menu)

    def _activate_macos_app(self) -> None:
        if sys.platform != "darwin":
            return
        try:
            app = NSApp()
            if app is None and NSApplication is not None:
                app = NSApplication.sharedApplication()
            if app is None:
                return
            if NSApplicationActivationPolicyRegular is not None:
                app.setActivationPolicy_(NSApplicationActivationPolicyRegular)
            app.activateIgnoringOtherApps_(True)
        except Exception as exc:
            LOGGER.debug("Failed to activate macOS app: %s", exc)

    def _activate_macos_for_permission_prompt(self) -> None:
        if sys.platform != "darwin":
            return
        try:
            app = NSApp()
            if app is None and NSApplication is not None:
                app = NSApplication.sharedApplication()
            if app is None:
                return
            app.activateIgnoringOtherApps_(True)
        except Exception as exc:
            LOGGER.debug("Failed to foreground macOS permission prompt: %s", exc)

    def _on_tray_show_settings(self, _icon, _item) -> None:
        LOGGER.info("Tray requested show-settings")
        print("Tray requested show-settings")
        self._launch_settings_window()

    def _on_tray_start_recording(self, _icon, _item) -> None:
        self._start_recording()

    def _on_tray_stop_recording(self, _icon, _item) -> None:
        self._stop_recording()

    def _on_tray_toggle_launch_at_login(self, _icon, _item) -> None:
        enabled = not self._settings.desktop.launch_at_login
        try:
            set_launch_at_login(enabled)
            self._settings.desktop.launch_at_login = enabled
            save_settings(self._settings)
            self._status_message = "已更新开机自启设置。"
        except Exception as exc:
            LOGGER.exception("Failed to toggle launch-at-login: %s", exc)
            self._status_message = f"更新开机自启失败：{exc}"
        self._publish({"kind": "sync-state"})

    def _on_tray_quit(self, _icon, _item) -> None:
        self._quitting = True
        self._stop_recording(join_timeout=2.0)
        _terminate_registered_window_processes()
        if self._tray_icon is not None:
            self._tray_icon.stop()
        if self._macos_app is not None:
            self._macos_app.terminate_(None)

    def _launch_settings_window(self) -> None:
        command = self._desktop_window_command()
        LOGGER.info("Launching settings window: %s", command)
        try:
            subprocess.Popen(
                command,
                start_new_session=True,
                cwd=str(Path.cwd()),
            )
        except Exception as exc:
            LOGGER.exception("Failed to launch settings window: %s", exc)
            self._status_message = f"打开设置失败：{exc}"
            self._refresh_tray_menu()

    def _desktop_window_command(self) -> list[str]:
        if getattr(sys, "frozen", False):
            return [sys.executable, "--window"]
        return [sys.executable, "-m", "eve.desktop_app", "--window"]

    def _format_input_devices(self) -> str:
        permission = microphone_permission_status()
        if permission.state in {"not_determined", "denied", "restricted"}:
            return f"{permission.message} 授权后再刷新设备列表。"
        try:
            import sounddevice as sd
        except Exception:
            return "无法读取设备列表：缺少 sounddevice 依赖。"

        try:
            devices = sd.query_devices()
        except Exception as exc:
            return f"无法读取设备列表：{exc}"

        lines: list[str] = []
        for index, device in enumerate(devices):
            try:
                max_inputs = int(device.get("max_input_channels", 0))
            except Exception:
                max_inputs = 0
            if max_inputs <= 0:
                continue
            name = str(device.get("name") or f"Device {index}").strip()
            lines.append(f"{index}: {name}")
        if not lines:
            return "当前没有检测到可用输入设备。"
        return "\n".join(lines)

    def _coerce_auto_switch_value(self, value: bool | None) -> bool:
        return True if value is None else bool(value)


def main() -> int:
    window_only = any(arg in {"window", "--window"} for arg in sys.argv[1:])
    controller = DesktopController(window_only=window_only)
    return controller.run()


if __name__ == "__main__":
    raise SystemExit(main())
