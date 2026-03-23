from __future__ import annotations

from argparse import Namespace
import json
import threading
import time
from pathlib import Path
from typing import Any

from eve.record_eve_24h import build_transcriber, create_live_recorder
from eve.transcribe_recordings import _run_once as run_transcribe_once
from eve.transcribe_recordings import build_transcriber as build_batch_transcriber
from eve.utils.logging_utils import init_logging

from sidecar_protocol import emit_message


DEFAULT_RECORDING_OVERRIDES = {
    "asr_max_batch_size": 1,
    "asr_max_new_tokens": 256,
    "asr_preload": False,
    "auto_switch_confirmations": 2,
    "auto_switch_cooldown_seconds": 8.0,
    "auto_switch_max_candidates_per_scan": 2,
    "auto_switch_min_ratio": 1.8,
    "auto_switch_probe_seconds": 0.25,
    "console_feedback": False,
}

DEFAULT_TRANSCRIBE_OVERRIDES = {
    "asr_device": "auto",
    "asr_dtype": "auto",
    "asr_language": "auto",
    "asr_max_batch_size": 1,
    "asr_max_new_tokens": 256,
    "asr_preload": False,
    "force": False,
    "limit": 0,
    "poll_seconds": 2.0,
    "prefix": "eve",
    "settle_seconds": 3.0,
    "watch": False,
}


def _status_from_snapshot(snapshot: Any) -> dict[str, Any]:
    return {
        "asrEnabled": bool(getattr(snapshot, "asr_enabled", True)),
        "asrHistory": list(getattr(snapshot, "asr_history", [])),
        "asrPreview": str(getattr(snapshot, "asr_preview", "")),
        "autoSwitchEnabled": bool(getattr(snapshot, "auto_switch_enabled", True)),
        "db": float(getattr(snapshot, "db", -80.0)),
        "deviceLabel": str(getattr(snapshot, "device_label", "default")),
        "elapsed": str(getattr(snapshot, "elapsed", "00:00:00")),
        "error": None,
        "inSpeech": bool(getattr(snapshot, "in_speech", False)),
        "levelRatio": float(getattr(snapshot, "level_ratio", 0.0)),
        "recording": True,
        "rms": float(getattr(snapshot, "rms", 0.0)),
        "statusMessage": "录音进行中。",
        "waveformBins": list(getattr(snapshot, "waveform_bins", [])),
    }


class SidecarRuntime:
    def __init__(self) -> None:
        init_logging()
        self._lock = threading.RLock()
        self._recorder = None
        self._recorder_thread: threading.Thread | None = None
        self._settings = {
            "desktop": {},
            "recording": {},
            "transcribe": {},
        }
        self._status_message = "桌面 sidecar 已就绪。"
        self._status_thread = threading.Thread(
            target=self._status_loop,
            daemon=True,
            name="eve-sidecar-status",
        )
        self._quitting = False
        self._status_thread.start()

    def close(self) -> None:
        self._quitting = True
        self.stop_recording()

    def apply_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._settings = settings
            recorder = self._recorder
        if recorder is not None:
            recorder.apply_runtime_settings(self._recording_args())
            self._sync_live_asr(recorder)
        self._status_message = "设置已同步到 sidecar。"
        return {"saved": True}

    def list_devices(self) -> list[dict[str, Any]]:
        try:
            import sounddevice as sd
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(f"sounddevice is unavailable: {exc}") from exc

        devices: list[dict[str, Any]] = []
        raw_devices = sd.query_devices()
        default_input = None
        try:
            default_input = int(sd.default.device[0])
        except Exception:
            default_input = None

        for index, device in enumerate(raw_devices):
            try:
                max_inputs = int(device.get("max_input_channels", 0))
            except Exception:
                max_inputs = 0
            if max_inputs <= 0:
                continue
            label = str(device.get("name") or f"Device {index}").strip()
            devices.append(
                {
                    "id": f"device:{index}",
                    "index": index,
                    "isDefault": index == default_input,
                    "label": label,
                }
            )
        return devices

    def start_recording(self) -> dict[str, Any]:
        with self._lock:
            if self._recorder_thread is not None and self._recorder_thread.is_alive():
                return {"alreadyRunning": True}
            recorder = create_live_recorder(self._recording_args())
            self._recorder = recorder
            thread = threading.Thread(
                target=self._run_recorder,
                args=(recorder,),
                daemon=True,
                name="eve-sidecar-recorder",
            )
            self._recorder_thread = thread
            thread.start()
        self._status_message = "录音线程已启动。"
        return {"started": True}

    def stop_recording(self) -> dict[str, Any]:
        with self._lock:
            recorder = self._recorder
            thread = self._recorder_thread
            self._recorder = None
            self._recorder_thread = None
        if recorder is not None:
            recorder.stop()
        if thread is not None and thread.is_alive():
            thread.join(timeout=2.0)
        self._status_message = "录音已停止。"
        return {"stopped": True}

    def status(self) -> dict[str, Any]:
        with self._lock:
            recorder = self._recorder
            thread = self._recorder_thread
        if recorder is not None and thread is not None and thread.is_alive():
            snapshot = recorder.feedback_snapshot()
            payload = _status_from_snapshot(snapshot)
            payload["statusMessage"] = self._status_message
            return payload
        return {
            "asrEnabled": not bool(self._settings["recording"].get("disableAsr", False)),
            "asrHistory": [],
            "asrPreview": "",
            "autoSwitchEnabled": bool(
                self._settings["recording"].get("autoSwitchDevice", True)
            ),
            "db": -80.0,
            "deviceLabel": str(self._settings["recording"].get("device", "default")),
            "elapsed": "00:00:00",
            "error": None,
            "inSpeech": False,
            "levelRatio": 0.0,
            "recording": False,
            "rms": 0.0,
            "statusMessage": self._status_message,
            "waveformBins": [0.0] * 48,
        }

    def run_transcribe(self, params: dict[str, Any] | None) -> dict[str, Any]:
        request = params or {}
        args = self._transcribe_args(request)
        transcriber = build_batch_transcriber(args)
        processed = run_transcribe_once(args, transcriber)
        self._status_message = f"历史转写完成，处理了 {processed} 个文件。"
        return {"processed": processed}

    def _recording_args(self) -> Namespace:
        recording = {**DEFAULT_RECORDING_OVERRIDES, **self._settings["recording"]}
        return Namespace(
            audio_format=recording.get("audioFormat", "flac"),
            asr_device=recording.get("asrDevice", "auto"),
            asr_dtype=recording.get("asrDtype", "auto"),
            asr_language=recording.get("asrLanguage", "auto"),
            asr_max_batch_size=recording.get(
                "asrMaxBatchSize", recording.get("asr_max_batch_size", 1)
            ),
            asr_max_new_tokens=recording.get(
                "asrMaxNewTokens", recording.get("asr_max_new_tokens", 256)
            ),
            asr_model=recording.get("asrModel", "Qwen/Qwen3-ASR-0.6B"),
            asr_preload=recording.get("asrPreload", recording.get("asr_preload", False)),
            auto_switch_confirmations=recording.get(
                "autoSwitchConfirmations", recording.get("auto_switch_confirmations", 2)
            ),
            auto_switch_cooldown_seconds=recording.get(
                "autoSwitchCooldownSeconds",
                recording.get("auto_switch_cooldown_seconds", 8.0),
            ),
            auto_switch_device=recording.get("autoSwitchDevice", True),
            auto_switch_max_candidates_per_scan=recording.get(
                "autoSwitchMaxCandidatesPerScan",
                recording.get("auto_switch_max_candidates_per_scan", 2),
            ),
            auto_switch_min_ratio=recording.get(
                "autoSwitchMinRatio", recording.get("auto_switch_min_ratio", 1.8)
            ),
            auto_switch_min_rms=recording.get("autoSwitchMinRms", 0.006),
            auto_switch_probe_seconds=recording.get(
                "autoSwitchProbeSeconds", recording.get("auto_switch_probe_seconds", 0.25)
            ),
            auto_switch_scan_seconds=recording.get("autoSwitchScanSeconds", 3.0),
            console_feedback=recording.get("consoleFeedback", False),
            console_feedback_hz=recording.get("consoleFeedbackHz", 12.0),
            device=recording.get("device", "default"),
            device_check_seconds=recording.get("deviceCheckSeconds", 2.0),
            device_retry_seconds=recording.get("deviceRetrySeconds", 2.0),
            disable_asr=recording.get("disableAsr", False),
            exclude_device_keywords=recording.get(
                "excludeDeviceKeywords", "iphone,continuity"
            ),
            output_dir=recording.get("outputDir", "recordings"),
            segment_minutes=recording.get("segmentMinutes", 60.0),
        )

    def _run_recorder(self, recorder: Any) -> None:
        try:
            recorder.start()
        except Exception as exc:
            self._status_message = f"录音线程异常退出：{exc}"
        finally:
            with self._lock:
                if self._recorder is recorder:
                    self._recorder = None
                if threading.current_thread() is self._recorder_thread:
                    self._recorder_thread = None

    def _status_loop(self) -> None:
        while not self._quitting:
            status = self.status()
            emit_message({"type": "status", "payload": status})
            emit_message(
                {
                    "type": "waveform",
                    "payload": {
                        "bins": status["waveformBins"],
                        "deviceLabel": status["deviceLabel"],
                    },
                }
            )
            emit_message(
                {
                    "type": "transcript-preview",
                    "payload": {
                        "history": status["asrHistory"],
                        "preview": status["asrPreview"],
                    },
                }
            )
            time.sleep(0.25)

    def _sync_live_asr(self, recorder: Any) -> None:
        recording = self._recording_args()
        if recording.disable_asr:
            recorder.disable_live_asr()
            return
        recorder.enable_live_asr(build_transcriber(recording))

    def _transcribe_args(self, params: dict[str, Any]) -> Namespace:
        recording = {**DEFAULT_RECORDING_OVERRIDES, **self._settings["recording"]}
        transcribe = {**DEFAULT_TRANSCRIBE_OVERRIDES, **self._settings["transcribe"]}
        input_dir = params.get("inputDir") or transcribe.get("inputDir", "recordings")
        return Namespace(
            asr_device=recording.get("asrDevice", "auto"),
            asr_dtype=recording.get("asrDtype", "auto"),
            asr_language=recording.get("asrLanguage", "auto"),
            asr_max_batch_size=recording.get(
                "asrMaxBatchSize", recording.get("asr_max_batch_size", 1)
            ),
            asr_max_new_tokens=recording.get(
                "asrMaxNewTokens", recording.get("asr_max_new_tokens", 256)
            ),
            asr_model=recording.get("asrModel", "Qwen/Qwen3-ASR-0.6B"),
            asr_preload=recording.get("asrPreload", recording.get("asr_preload", False)),
            force=bool(params.get("force", transcribe.get("force", False))),
            input_dir=input_dir,
            limit=int(params.get("limit", transcribe.get("limit", 0))),
            poll_seconds=transcribe.get("pollSeconds", transcribe.get("poll_seconds", 2.0)),
            prefix=transcribe.get("prefix", "eve"),
            settle_seconds=transcribe.get(
                "settleSeconds", transcribe.get("settle_seconds", 3.0)
            ),
            watch=bool(transcribe.get("watch", False)),
        )

    def snapshot_json(self) -> str:
        return json.dumps(self.status(), ensure_ascii=False)
