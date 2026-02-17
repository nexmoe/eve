import json
import logging
import math
import os
import queue
import shutil
import sys
import threading
import time
import unicodedata
from collections import deque
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime

import numpy as np

from ..utils.segment_utils import iso_now, write_json_atomic

try:
    import sounddevice as sd
except Exception as exc:  # pragma: no cover
    raise RuntimeError(
        "sounddevice is required for live recording. Install it with `pip install sounddevice`."
    ) from exc

try:
    import soundfile as sf
except Exception as exc:  # pragma: no cover
    raise RuntimeError(
        "soundfile is required for live recording. Install it with `pip install soundfile`."
    ) from exc


class DeviceUnavailableError(RuntimeError):
    pass


class DeviceSwitchRequest(RuntimeError):
    pass


@dataclass
class VadConfig:
    sample_rate: int = 16000
    channels: int = 1
    chunk_ms: int = 32
    speech_pad_ms: int = 300
    min_silence_ms: int = 1200
    max_segment_minutes: float = 60.0
    max_speech_segment_seconds: float = 20.0
    device_check_seconds: float = 2.0
    device_retry_seconds: float = 2.0
    auto_switch_enabled: bool = True
    auto_switch_scan_seconds: float = 3.0
    auto_switch_probe_seconds: float = 0.25
    auto_switch_max_candidates_per_scan: int = 2
    excluded_input_keywords: tuple[str, ...] = ("iphone", "continuity")
    auto_switch_min_rms: float = 0.006
    auto_switch_min_ratio: float = 1.8
    auto_switch_cooldown_seconds: float = 8.0
    auto_switch_confirmations: int = 2
    console_feedback_enabled: bool = True
    console_feedback_hz: float = 12.0
    console_feedback_meter_width: int = 20
    console_asr_preview_enabled: bool = True
    console_asr_preview_max_chars: int = 16
    console_asr_preview_hold_seconds: float = 30.0
    console_asr_history_size: int = 8


class LiveVadRecorder:
    def __init__(
        self,
        *,
        output_dir: str,
        prefix: str,
        device: str,
        vad,
        transcriber,
    ) -> None:
        self.output_dir = output_dir
        self.prefix = prefix
        self.device = self._normalize_device(device)
        self._requested_default_device = self.device is None
        self.vad = vad
        self.transcriber = transcriber
        self.config = VadConfig()
        self._stop_event = threading.Event()
        self._audio_queue: queue.Queue[np.ndarray] = queue.Queue()
        self._asr_queue: queue.Queue[tuple] = queue.Queue()
        self._asr_worker: threading.Thread | None = None
        self._asr_worker_sentinel = object()
        self._asr_pending_jobs: dict[str, int] = {}
        self._asr_json_lock = threading.Lock()
        self._writer = None
        self._segment_start_time = None
        self._last_voice_time = None
        self._stream_start_time = None
        self._total_samples = 0
        self._in_speech = False
        self._speech_start_sample = None
        self._speech_start_time = None
        self._speech_buffer: list[np.ndarray] = []
        self._had_speech = False
        self._segment_has_transcripts = False
        self._live_json_path = None
        self._pending_end_sample = None
        self._pending_end_time = None
        self._last_device_check = 0.0
        self._device_unavailable = False
        self._device_fingerprint: dict | None = None
        self._device_list_snapshot: tuple | None = None
        self._last_auto_switch_check = 0.0
        self._auto_switch_round_robin_offset = 0
        self._last_switch_time = 0.0
        self._switch_candidate: int | None = None
        self._switch_candidate_hits = 0
        self._last_input_rms = 0.0
        self._probe_backoff_until: dict[int, float] = {}
        self._native_stderr_lock = threading.Lock()
        self._console_last_refresh = 0.0
        self._console_status_active = False
        self._console_status_length = 0
        self._active_input_device_label = "default"
        self._last_asr_preview = ""
        self._last_asr_preview_time = 0.0
        self._asr_history: deque[str] = deque(maxlen=self.config.console_asr_history_size)
        self._console_state_lock = threading.Lock()
        self._logger = logging.getLogger(__name__)

    def _start_asr_worker(self) -> None:
        if self.transcriber is None or self._asr_worker is not None:
            return
        self._asr_worker = threading.Thread(
            target=self._asr_worker_loop,
            daemon=True,
            name="eve-asr-worker",
        )
        self._asr_worker.start()

    def _stop_asr_worker(self) -> None:
        if self._asr_worker is None:
            return
        self._asr_queue.put(self._asr_worker_sentinel)
        self._asr_worker.join(timeout=0.5)
        self._asr_worker = None

    def _asr_worker_loop(self) -> None:
        while True:
            item = self._asr_queue.get()
            if item is self._asr_worker_sentinel:
                self._asr_queue.task_done()
                break
            audio, sample_rate, start_iso, end_iso, json_path = item
            try:
                if self.transcriber is None or json_path is None:
                    continue
                result = self.transcriber.transcribe_audio((audio, sample_rate))
                text = (result.get("text") or "").strip()
                if not text:
                    continue
                payload = {
                    "start_time_iso": start_iso,
                    "end_time_iso": end_iso,
                    "language": (result.get("language") or "").strip() or None,
                    "text": text,
                }
                self._record_console_asr_output(text)
                self._append_live_segment(payload, json_path=json_path)
            except Exception as exc:
                self._logger.warning(
                    "ASR transcription failed for segment (%s): %s", json_path, exc
                )
            finally:
                with self._asr_json_lock:
                    remaining = self._asr_pending_jobs.get(json_path, 0) - 1
                    if remaining > 0:
                        self._asr_pending_jobs[json_path] = remaining
                    else:
                        self._asr_pending_jobs.pop(json_path, None)
                self._asr_queue.task_done()

    def _normalize_device(self, device: str | None):
        if device in ("", "default", "auto", None):
            return None
        if isinstance(device, str) and device.startswith(":"):
            try:
                return int(device[1:])
            except ValueError:
                return device
        try:
            return int(device)
        except Exception:
            return device

    def _device_label(self) -> str:
        if self.device is None:
            return "default"
        return str(self.device)

    def _resolve_device_index(self, device=None) -> int | None:
        target = self.device if device is None else device
        if isinstance(target, int):
            return target
        if target is None:
            try:
                default_input = sd.default.device[0]
            except Exception:
                return None
            if default_input is None:
                return None
            try:
                default_index = int(default_input)
            except Exception:
                return None
            if default_index < 0:
                return self._select_fallback_input_device()
            try:
                info = sd.query_devices(default_index, kind="input")
            except Exception:
                return self._select_fallback_input_device()
            if self._is_excluded_input_device(info):
                fallback = self._select_fallback_input_device()
                if fallback is not None:
                    return fallback
            return default_index
        try:
            info = sd.query_devices(target, kind="input")
        except Exception:
            return None
        return self._find_device_index(info.get("name"), info.get("hostapi"))

    def _format_device_label(self, device_index: int | None) -> str:
        if device_index is None:
            return "default"
        try:
            info = sd.query_devices(device_index, kind="input")
        except Exception:
            return str(device_index)
        name = (info.get("name") or "").strip()
        if not name:
            return str(device_index)
        return f"{device_index}:{name}"

    def _normalized_excluded_input_keywords(self) -> tuple[str, ...]:
        normalized: list[str] = []
        for keyword in self.config.excluded_input_keywords:
            text = str(keyword).strip().lower()
            if text:
                normalized.append(text)
        return tuple(normalized)

    def _is_excluded_input_device(self, info: dict) -> bool:
        keywords = self._normalized_excluded_input_keywords()
        if not keywords:
            return False
        name = str(info.get("name") or "").strip().lower()
        if not name:
            return False
        return any(keyword in name for keyword in keywords)

    def _select_fallback_input_device(self, *, include_excluded: bool = False) -> int | None:
        indexes = self._list_input_devices(include_excluded=include_excluded)
        if not indexes and not include_excluded:
            indexes = self._list_input_devices(include_excluded=True)
        if not indexes:
            return None
        preferred_tokens = ("macbook", "built-in", "internal")
        for idx in indexes:
            try:
                info = sd.query_devices(idx, kind="input")
            except Exception:
                continue
            name = str(info.get("name") or "").strip().lower()
            if any(token in name for token in preferred_tokens):
                return idx
        return indexes[0]

    def _list_input_devices(self, *, include_excluded: bool = False) -> list[int]:
        try:
            devices = sd.query_devices()
        except Exception:
            return []
        indexes: list[int] = []
        for idx, info in enumerate(devices):
            try:
                max_inputs = int(info.get("max_input_channels", 0))
            except Exception:
                max_inputs = 0
            if max_inputs >= self.config.channels:
                if not include_excluded and self._is_excluded_input_device(info):
                    continue
                indexes.append(idx)
        return indexes

    def _measure_rms(self, audio: np.ndarray) -> float:
        if audio.size == 0:
            return 0.0
        signal = audio.astype(np.float64, copy=False)
        return float(np.sqrt(np.mean(signal * signal)))

    def _probe_device_rms(self, device_index: int) -> float:
        backoff_until = self._probe_backoff_until.get(device_index)
        if backoff_until and time.time() < backoff_until:
            return 0.0
        probe_seconds = self.config.auto_switch_probe_seconds
        if probe_seconds <= 0:
            return 0.0
        probe_frames = max(1, int(self.config.sample_rate * probe_seconds))
        try:
            info = sd.query_devices(device_index, kind="input")
            max_inputs = int(info.get("max_input_channels", 0))
        except Exception:
            return 0.0
        if self._is_excluded_input_device(info):
            return 0.0
        channels = min(self.config.channels, max_inputs)
        if channels <= 0:
            return 0.0
        try:
            with self._suppress_native_stderr():
                with sd.InputStream(
                    samplerate=self.config.sample_rate,
                    channels=channels,
                    dtype="float32",
                    blocksize=probe_frames,
                    device=device_index,
                ) as probe_stream:
                    data, _overflowed = probe_stream.read(probe_frames)
        except Exception:
            # Back off noisy/unavailable probe targets for a short period.
            self._probe_backoff_until[device_index] = time.time() + 30.0
            return 0.0
        return self._measure_rms(np.asarray(data).reshape(-1))

    @contextmanager
    def _suppress_native_stderr(self):
        try:
            devnull_fd = os.open(os.devnull, os.O_WRONLY)
        except Exception:
            yield
            return
        with self._native_stderr_lock:
            try:
                original_fd = os.dup(2)
            except Exception:
                os.close(devnull_fd)
                yield
                return
            try:
                os.dup2(devnull_fd, 2)
                yield
            finally:
                try:
                    os.dup2(original_fd, 2)
                finally:
                    os.close(original_fd)
                    os.close(devnull_fd)

    def _clear_switch_candidate(self) -> None:
        self._switch_candidate = None
        self._switch_candidate_hits = 0

    def _console_feedback_stream(self):
        if not self.config.console_feedback_enabled:
            return None
        if sys.stdout.isatty():
            return sys.stdout
        if sys.stderr.isatty():
            return sys.stderr
        return None

    def _clear_console_feedback_line(self) -> None:
        stream = self._console_feedback_stream()
        if stream is None:
            return
        if not self._console_status_active:
            return
        line_count = max(1, int(self._console_status_length))
        if line_count > 1:
            stream.write(f"\x1b[{line_count - 1}A")
        for idx in range(line_count):
            stream.write("\r\x1b[2K")
            if idx < line_count - 1:
                stream.write("\n")
        stream.flush()
        self._console_status_active = False
        self._console_status_length = 0

    def _char_display_width(self, ch: str) -> int:
        if not ch:
            return 0
        if ch == "\t":
            return 4
        if ord(ch) < 32 or ord(ch) == 127:
            return 0
        if unicodedata.east_asian_width(ch) in ("F", "W"):
            return 2
        return 1

    def _display_width(self, text: str) -> int:
        return sum(self._char_display_width(ch) for ch in text)

    def _shorten_by_display_width(self, text: str, max_width: int) -> str:
        if max_width <= 0:
            return ""
        if self._display_width(text) <= max_width:
            return text
        ellipsis = "..."
        ellipsis_width = self._display_width(ellipsis)
        if max_width <= ellipsis_width:
            return text[:max(0, max_width)]
        target = max_width - ellipsis_width
        out: list[str] = []
        used = 0
        for ch in text:
            w = self._char_display_width(ch)
            if used + w > target:
                break
            out.append(ch)
            used += w
        return "".join(out).rstrip() + ellipsis

    def _terminal_columns(self) -> int:
        try:
            width = shutil.get_terminal_size(fallback=(80, 24)).columns
        except Exception:
            width = 80
        return max(40, int(width))

    def _record_console_asr_output(self, text: str) -> None:
        normalized = " ".join((text or "").split())
        if not normalized:
            return
        with self._console_state_lock:
            self._last_asr_preview = normalized
            self._last_asr_preview_time = time.time()
            self._asr_history.append(normalized)

    def _get_console_asr_preview(self, now: float) -> str:
        if not self.config.console_asr_preview_enabled:
            return ""
        hold_seconds = max(0.0, float(self.config.console_asr_preview_hold_seconds))
        with self._console_state_lock:
            text = self._last_asr_preview
            timestamp = self._last_asr_preview_time
        if not text:
            return ""
        if hold_seconds > 0 and now - timestamp > hold_seconds:
            return ""
        max_chars = max(8, int(self.config.console_asr_preview_max_chars))
        return self._shorten(text, max_len=max_chars)

    def _get_console_asr_history_preview(self) -> str:
        if not self.config.console_asr_preview_enabled:
            return ""
        with self._console_state_lock:
            if not self._asr_history:
                return ""
            history = list(self._asr_history)
        # Keep a small rolling context in a fixed console area.
        return " | ".join(history[-3:])

    def _format_elapsed(self) -> str:
        if self._stream_start_time is None:
            return "00:00:00"
        elapsed = max(0, int(time.time() - self._stream_start_time))
        hours = elapsed // 3600
        minutes = (elapsed % 3600) // 60
        seconds = elapsed % 60
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    def _scale_rms_to_ratio(self, rms: float) -> float:
        db = self._rms_to_db(rms)
        # Log-scale meter so low-volume speech still produces visible movement.
        floor_db = -72.0
        ceiling_db = -18.0
        return max(0.0, min(1.0, (db - floor_db) / (ceiling_db - floor_db)))

    def _rms_to_db(self, rms: float) -> float:
        return 20.0 * math.log10(max(rms, 1e-8))

    def _build_level_meter(self, rms: float) -> str:
        width = max(8, int(self.config.console_feedback_meter_width))
        filled = int(round(width * self._scale_rms_to_ratio(rms)))
        if rms > 0 and filled == 0:
            filled = 1
        filled = max(0, min(width, filled))
        return "[" + ("#" * filled) + ("-" * (width - filled)) + "]"

    def _shorten(self, value: str, max_len: int = 28) -> str:
        text = (value or "").strip()
        if len(text) <= max_len:
            return text
        if max_len <= 3:
            return text[:max_len]
        return text[: max_len - 3] + "..."

    def _render_console_feedback(self, *, force: bool = False) -> None:
        stream = self._console_feedback_stream()
        if stream is None:
            return
        hz = max(0.5, float(self.config.console_feedback_hz))
        now = time.time()
        if not force and now - self._console_last_refresh < 1.0 / hz:
            return
        self._console_last_refresh = now
        state = "SPEECH" if self._in_speech else "IDLE"
        auto_state = "ON" if self.config.auto_switch_enabled else "OFF"
        meter = self._build_level_meter(self._last_input_rms)
        db_text = f"{self._rms_to_db(self._last_input_rms):6.1f}dB"
        device = self._shorten(self._active_input_device_label, max_len=28)
        asr_history = self._get_console_asr_history_preview()
        line_base = (
            f"REC {self._format_elapsed()} | {meter} {db_text} | {state} | "
            f"MIC {device} | AUTO {auto_state}"
        )
        width_limit = self._terminal_columns() - 1
        status_line = self._shorten_by_display_width(line_base, width_limit)
        asr_line_prefix = "ASR | "
        asr_remaining = max(8, width_limit - self._display_width(asr_line_prefix))
        asr_line = asr_line_prefix + self._shorten_by_display_width(asr_history, asr_remaining)
        previous_count = max(0, int(self._console_status_length))
        if previous_count > 1:
            stream.write(f"\x1b[{previous_count - 1}A")
        stream.write("\r\x1b[2K" + status_line)
        stream.write("\n\r\x1b[2K" + asr_line)
        stream.flush()
        self._console_status_active = True
        self._console_status_length = 2

    def _mark_switch_candidate(self, device_index: int) -> bool:
        if self._switch_candidate == device_index:
            self._switch_candidate_hits += 1
        else:
            self._switch_candidate = device_index
            self._switch_candidate_hits = 1
        required = max(1, int(self.config.auto_switch_confirmations))
        return self._switch_candidate_hits >= required

    def _check_auto_switch(self) -> None:
        if not self.config.auto_switch_enabled:
            return
        interval = self.config.auto_switch_scan_seconds
        if interval <= 0:
            return
        now = time.time()
        if now - self._last_auto_switch_check < interval:
            return
        self._last_auto_switch_check = now
        if self._in_speech:
            self._clear_switch_candidate()
            return
        cooldown = self.config.auto_switch_cooldown_seconds
        if cooldown > 0 and now - self._last_switch_time < cooldown:
            return
        current_index = self._resolve_device_index()
        current_rms = self._last_input_rms
        candidate_indexes: list[int] = []
        for device_index in self._list_input_devices():
            if current_index is not None and device_index == current_index:
                continue
            candidate_indexes.append(device_index)
        if not candidate_indexes:
            self._clear_switch_candidate()
            return
        max_candidates = max(1, int(self.config.auto_switch_max_candidates_per_scan))
        if len(candidate_indexes) > max_candidates:
            start = self._auto_switch_round_robin_offset % len(candidate_indexes)
            probe_indexes = [
                candidate_indexes[(start + i) % len(candidate_indexes)]
                for i in range(max_candidates)
            ]
            self._auto_switch_round_robin_offset = (start + max_candidates) % len(
                candidate_indexes
            )
        else:
            probe_indexes = candidate_indexes
            self._auto_switch_round_robin_offset = 0
        best_index = None
        best_rms = 0.0
        for device_index in probe_indexes:
            rms = self._probe_device_rms(device_index)
            if rms > best_rms:
                best_rms = rms
                best_index = device_index
        min_rms = max(0.0, self.config.auto_switch_min_rms)
        if best_index is None or best_rms < min_rms:
            self._clear_switch_candidate()
            return
        min_ratio = max(1.0, self.config.auto_switch_min_ratio)
        if current_rms >= min_rms and best_rms < current_rms * min_ratio:
            self._clear_switch_candidate()
            return
        if not self._mark_switch_candidate(best_index):
            return
        previous_label = self._format_device_label(current_index)
        target_label = self._format_device_label(best_index)
        self.device = best_index
        self._last_switch_time = now
        self._device_fingerprint = None
        self._device_list_snapshot = None
        self._clear_switch_candidate()
        raise DeviceSwitchRequest(
            f"Auto-switched microphone from {previous_label} to {target_label} (rms {best_rms:.5f})."
        )

    def _capture_device_fingerprint(self) -> None:
        if self.device is None:
            self._device_fingerprint = None
            self._device_list_snapshot = None
            return
        try:
            info = sd.query_devices(self.device, kind="input")
        except Exception:
            return
        self._device_fingerprint = {
            "name": info.get("name"),
            "hostapi": info.get("hostapi"),
        }
        self._device_list_snapshot = self._snapshot_device_list()

    def _snapshot_device_list(self) -> tuple:
        try:
            devices = sd.query_devices()
        except Exception:
            return ()
        snapshot = []
        for info in devices:
            try:
                max_inputs = int(info.get("max_input_channels", 0))
            except Exception:
                max_inputs = 0
            snapshot.append(
                (info.get("name"), info.get("hostapi"), max_inputs)
            )
        return tuple(snapshot)

    def _device_list_changed(self) -> bool:
        if self.device is None or self._device_fingerprint is None:
            return False
        snapshot = self._snapshot_device_list()
        if not snapshot:
            return False
        if self._device_list_snapshot is None:
            self._device_list_snapshot = snapshot
            return False
        if snapshot == self._device_list_snapshot:
            return False
        self._device_list_snapshot = snapshot
        return True

    def _find_device_index(self, name: str | None, hostapi: int | None) -> int | None:
        if not name:
            return None
        try:
            devices = sd.query_devices()
        except Exception:
            return None
        for idx, info in enumerate(devices):
            if info.get("name") != name:
                continue
            if hostapi is not None and info.get("hostapi") != hostapi:
                continue
            try:
                max_inputs = int(info.get("max_input_channels", 0))
            except Exception:
                max_inputs = 0
            if max_inputs > 0:
                return idx
        return None

    def _preflight_device(self) -> None:
        if not self._device_fingerprint or self.device is None:
            return
        name = self._device_fingerprint.get("name")
        hostapi = self._device_fingerprint.get("hostapi")
        try:
            info = sd.query_devices(self.device, kind="input")
        except Exception:
            new_index = self._find_device_index(name, hostapi)
            if new_index is not None:
                self.device = new_index
                return
            raise DeviceUnavailableError(
                f"input device '{self._device_label()}' is not available"
            )
        if info.get("name") != name or info.get("hostapi") != hostapi:
            new_index = self._find_device_index(name, hostapi)
            if new_index is not None:
                self.device = new_index
                return
            raise DeviceUnavailableError(
                f"input device '{self._device_label()}' is not available"
            )

    def _is_device_available(self) -> bool:
        try:
            info = sd.query_devices(self.device, kind="input")
        except Exception:
            return False
        try:
            max_inputs = int(info.get("max_input_channels", 0))
        except Exception:
            max_inputs = 0
        if max_inputs <= 0:
            return False
        if self._device_fingerprint and self.device is not None:
            name = self._device_fingerprint.get("name")
            hostapi = self._device_fingerprint.get("hostapi")
            if info.get("name") != name or info.get("hostapi") != hostapi:
                new_index = self._find_device_index(name, hostapi)
                if new_index is not None and new_index != self.device:
                    self.device = new_index
                return False
        return True

    def _check_device_health(self) -> None:
        interval = self.config.device_check_seconds
        if interval <= 0:
            return
        now = time.time()
        if now - self._last_device_check < interval:
            return
        self._last_device_check = now
        if self._device_list_changed() and self._device_fingerprint is not None:
            name = self._device_fingerprint.get("name")
            hostapi = self._device_fingerprint.get("hostapi")
            new_index = self._find_device_index(name, hostapi)
            if new_index is None:
                raise DeviceUnavailableError(
                    f"input device '{self._device_label()}' is not available"
                )
            if new_index != self.device:
                self.device = new_index
                raise DeviceUnavailableError(
                    f"input device '{self._device_label()}' index changed"
                )
        if not self._is_device_available():
            raise DeviceUnavailableError(
                f"input device '{self._device_label()}' is not available"
            )

    def _drain_audio_queue(self) -> None:
        try:
            while True:
                self._audio_queue.get_nowait()
        except queue.Empty:
            pass

    def _reset_stream_state(self) -> None:
        self._speech_buffer = []
        self._reset_speech_state()
        self._total_samples = 0
        self._segment_start_time = None
        self._stream_start_time = None
        self._last_voice_time = None
        self._had_speech = False
        self._segment_has_transcripts = False
        self._last_input_rms = 0.0
        self._clear_switch_candidate()
        self._drain_audio_queue()

    def _handle_device_error(self, message: str) -> None:
        self._clear_console_feedback_line()
        self._close_stream()
        self._reset_stream_state()
        if self._requested_default_device or self.config.auto_switch_enabled:
            fallback_index = self._select_fallback_input_device()
            if fallback_index is not None and fallback_index != self.device:
                previous = self._device_label()
                self.device = fallback_index
                self._device_fingerprint = None
                self._device_list_snapshot = None
                self._clear_switch_candidate()
                self._logger.warning(
                    "Microphone unavailable (%s). Switched from %s to %s.",
                    message,
                    previous,
                    self._format_device_label(fallback_index),
                )
                self._device_unavailable = True
                return
        retry_seconds = self.config.device_retry_seconds
        if not self._device_unavailable:
            self._logger.warning(
                "Microphone unavailable (%s). Retrying in %.1fs...",
                message,
                retry_seconds,
            )
            self._device_unavailable = True
        if retry_seconds > 0:
            self._stop_event.wait(timeout=retry_seconds)

    def _handle_device_switch(self, message: str) -> None:
        self._clear_console_feedback_line()
        self._close_stream()
        self._reset_stream_state()
        self._device_unavailable = False
        self._logger.info("%s", message)

    def _open_live_file(self) -> None:
        now = datetime.now().astimezone()
        date_folder = now.strftime("%Y%m%d")
        filename = f"{self.prefix}_live_{now.strftime('%Y%m%d_%H%M%S')}.wav"
        day_dir = os.path.join(self.output_dir, date_folder)
        os.makedirs(day_dir, exist_ok=True)
        path = os.path.join(day_dir, filename)
        self._writer = sf.SoundFile(
            path,
            mode="w",
            samplerate=self.config.sample_rate,
            channels=self.config.channels,
            subtype="PCM_16",
        )
        self._segment_start_time = time.time()
        self._stream_start_time = self._segment_start_time
        self._live_json_path = os.path.splitext(path)[0] + ".json"
        self._active_input_device_label = self._format_device_label(
            self._resolve_device_index()
        )
        self._had_speech = False
        self._segment_has_transcripts = False
        with self._asr_json_lock:
            self._asr_pending_jobs.pop(self._live_json_path, None)
        self._init_live_json(path, now)

    def _init_live_json(self, audio_path: str, now: datetime) -> None:
        model_name = self.transcriber.model_name if self.transcriber else None
        backend = self.transcriber.backend if self.transcriber else None
        resolved_device = (
            self.transcriber._resolved_device if self.transcriber else None
        )
        resolved_dtype = (
            self.transcriber._resolved_dtype if self.transcriber else None
        )
        payload = {
            "audio_file": os.path.basename(audio_path),
            "audio_path": os.path.abspath(audio_path),
            "segment_start": now.strftime("%Y%m%d_%H%M%S"),
            "segment_start_time": now.isoformat(),
            "model": model_name,
            "backend": backend,
            "created_at": iso_now(),
            "device": resolved_device,
            "dtype": resolved_dtype,
            "input_device": self._active_input_device_label,
            "auto_switch_device": self.config.auto_switch_enabled,
            "asr_enabled": self.transcriber is not None,
            "asr_mode": "live" if self.transcriber is not None else "disabled",
            "status": "recording",
            "speech_segments": [],
            "language": None,
            "text": "",
        }
        write_json_atomic(self._live_json_path, payload)

    def _finalize_live_json(self) -> None:
        if not self._live_json_path:
            return
        live_json_path = self._live_json_path
        with self._asr_json_lock:
            try:
                with open(live_json_path, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
                if not isinstance(data, dict):
                    data = {}
            except Exception:
                data = {}
            pending = self._asr_pending_jobs.get(live_json_path, 0)
            status = data.get("status")
            if status != "ok":
                if self.transcriber is None:
                    if self._had_speech:
                        status = "pending_asr"
                    else:
                        status = "no_speech"
                else:
                    if self._segment_has_transcripts:
                        status = "ok"
                    elif pending > 0:
                        status = "pending_asr"
                    else:
                        status = "no_speech" if not self._had_speech else "no_text"
            data["status"] = status
            if "asr_enabled" not in data:
                data["asr_enabled"] = self.transcriber is not None
            write_json_atomic(live_json_path, data)

    def _close_stream(self) -> None:
        if self._writer is not None:
            self._writer.flush()
            self._writer.close()
        self._writer = None
        self._segment_start_time = None
        self._finalize_live_json()

    def _should_rotate(self) -> bool:
        if self._segment_start_time is None:
            return False
        elapsed = time.time() - self._segment_start_time
        return elapsed >= self.config.max_segment_minutes * 60

    def _should_rotate_speech(self) -> bool:
        if self._speech_start_time is None:
            return False
        elapsed = time.time() - self._speech_start_time
        return elapsed >= self.config.max_speech_segment_seconds

    def _append_live_segment(self, payload: dict, *, json_path: str | None = None) -> None:
        path = json_path or self._live_json_path
        if not path:
            return
        with self._asr_json_lock:
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
                if not isinstance(data, dict):
                    data = {}
            except Exception:
                data = {}
            speech_segments = data.get("speech_segments")
            if not isinstance(speech_segments, list):
                speech_segments = []
            speech_segments.append(payload)
            data["speech_segments"] = speech_segments
            texts = [seg.get("text") for seg in speech_segments if seg.get("text")]
            data["text"] = "\n".join(texts)
            languages = [seg.get("language") for seg in speech_segments if seg.get("language")]
            data["language"] = ", ".join(sorted(set(languages))) if languages else None
            if path == self._live_json_path:
                self._segment_has_transcripts = True
            data["status"] = "ok"
            write_json_atomic(path, data)

    def _queue_asr_segment(
        self, audio: np.ndarray, start_iso: str, end_iso: str, json_path: str | None
    ) -> None:
        if self.transcriber is None or json_path is None:
            return
        with self._asr_json_lock:
            self._asr_pending_jobs[json_path] = (
                self._asr_pending_jobs.get(json_path, 0) + 1
            )
        self._asr_queue.put((audio, self.config.sample_rate, start_iso, end_iso, json_path))

    def _reset_speech_state(self) -> None:
        self._in_speech = False
        self._speech_start_sample = None
        self._speech_start_time = None
        self._pending_end_sample = None
        self._pending_end_time = None

    def _finalize_speech_segment(self, end_sample: int) -> None:
        if not self._speech_buffer:
            self._reset_speech_state()
            return
        if self.transcriber is None:
            self._speech_buffer = []
            self._reset_speech_state()
            return
        audio = np.concatenate(self._speech_buffer)
        self._speech_buffer = []
        start_time = self._stream_start_time + (self._speech_start_sample or 0) / self.config.sample_rate
        end_time = self._stream_start_time + end_sample / self.config.sample_rate
        start_iso = datetime.fromtimestamp(start_time).astimezone().isoformat()
        end_iso = datetime.fromtimestamp(end_time).astimezone().isoformat()
        self._queue_asr_segment(audio, start_iso, end_iso, self._live_json_path)
        self._reset_speech_state()

    def _audio_callback(self, indata, frames, time_info, status) -> None:
        if status:
            pass
        self._audio_queue.put(indata.copy())

    def _record_loop(self) -> None:
        if self._requested_default_device and self.device is None:
            preferred_index = self._resolve_device_index()
            if preferred_index is not None:
                self.device = preferred_index
        sr = self.config.sample_rate
        chunk_samples = int(sr * self.config.chunk_ms / 1000)
        self._preflight_device()
        with sd.InputStream(
            samplerate=sr,
            channels=self.config.channels,
            dtype="float32",
            blocksize=chunk_samples,
            callback=self._audio_callback,
            device=self.device,
        ):
            self._capture_device_fingerprint()
            self._open_live_file()
            if self._device_unavailable:
                self._clear_console_feedback_line()
                self._logger.info("Microphone restored. Resuming recording.")
                self._device_unavailable = False
            while not self._stop_event.is_set():
                self._check_device_health()
                try:
                    block = self._audio_queue.get(timeout=0.1)
                except queue.Empty:
                    continue
                audio = block.reshape(-1)
                for offset in range(0, len(audio), chunk_samples):
                    chunk = audio[offset : offset + chunk_samples]
                    if len(chunk) != chunk_samples:
                        continue
                    chunk_rms = self._measure_rms(chunk)
                    if self._last_input_rms <= 0:
                        self._last_input_rms = chunk_rms
                    else:
                        if chunk_rms >= self._last_input_rms:
                            self._last_input_rms = chunk_rms
                        else:
                            self._last_input_rms = 0.85 * self._last_input_rms + 0.15 * chunk_rms
                    vad_events = self.vad.detect_chunk(chunk)
                    now = time.time()
                    if vad_events:
                        vad_events.sort(key=lambda item: item.get("start", item.get("end", 0)))
                    cursor = 0
                    for event in vad_events:
                        if "start" in event:
                            start = int(event["start"])
                            if not self._in_speech:
                                self._in_speech = True
                                self._speech_start_sample = self._total_samples + start
                                self._speech_start_time = (
                                    self._stream_start_time + self._speech_start_sample / sr
                                )
                                self._pending_end_sample = None
                                self._pending_end_time = None
                            cursor = start
                        if "end" in event and self._in_speech:
                            end = int(event["end"])
                            if end > cursor:
                                if self.transcriber is not None:
                                    self._speech_buffer.append(chunk[cursor:end])
                            self._writer.write(chunk[cursor:end])
                            self._had_speech = True
                            self._pending_end_sample = self._total_samples + end
                            self._pending_end_time = now
                            self._in_speech = False
                            cursor = end
                    if self._in_speech:
                        if self.transcriber is not None:
                            self._speech_buffer.append(chunk[cursor:])
                        self._writer.write(chunk[cursor:])
                        self._had_speech = True
                        self._last_voice_time = now
                        if self._should_rotate_speech():
                            end_sample = self._total_samples + len(chunk)
                            self._finalize_speech_segment(end_sample)
                    else:
                        if self._pending_end_time is not None:
                            silence = now - self._pending_end_time
                            if silence * 1000 >= self.config.min_silence_ms:
                                self._finalize_speech_segment(self._pending_end_sample or self._total_samples)
                    self._total_samples += len(chunk)
                self._render_console_feedback()
                self._check_auto_switch()
                if self._should_rotate():
                    self._close_stream()
                    self._open_live_file()

    def start(self) -> None:
        self._start_asr_worker()
        self._stop_event.clear()
        while not self._stop_event.is_set():
            try:
                self._record_loop()
                return
            except DeviceSwitchRequest as exc:
                self._handle_device_switch(str(exc))
            except DeviceUnavailableError as exc:
                self._handle_device_error(str(exc))
            except sd.PortAudioError as exc:
                self._handle_device_error(str(exc))

    def stop(self) -> None:
        self._clear_console_feedback_line()
        self._stop_event.set()
        if self._in_speech:
            end_sample = self._total_samples
            self._finalize_speech_segment(end_sample)
        self._close_stream()
        self._stop_asr_worker()
