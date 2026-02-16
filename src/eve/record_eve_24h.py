#!/usr/bin/env python3
import argparse
import logging

from .utils.logging_utils import init_logging
from .asr.qwen import QwenASRTranscriber
from .recorders.live_vad_recorder import LiveVadRecorder
from .recorders.silero_vad import SileroVAD


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Record system microphone continuously for 24 hours and archive in segments. "
            "Transcribes each segment with Qwen3-ASR by default. "
            "VAD is applied during recording to keep only speech."
        )
    )
    parser.add_argument(
        "--device",
        default="default",
        help=(
            "Audio device for input. Use --list-devices to discover device indexes. "
            "Accepts index (e.g. 1), name, or :index (e.g. :1). "
            "Use --no-auto-switch-device to disable runtime microphone switching."
        ),
    )
    parser.add_argument(
        "--output-dir",
        default="recordings",
        help="Directory to store audio segments.",
    )
    parser.add_argument(
        "--device-check-seconds",
        type=float,
        default=2.0,
        help="Seconds between microphone availability checks (<=0 to disable).",
    )
    parser.add_argument(
        "--device-retry-seconds",
        type=float,
        default=2.0,
        help="Seconds to wait before retrying after a device error.",
    )
    parser.add_argument(
        "--auto-switch-device",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Automatically switch to the input device that currently has usable audio.",
    )
    parser.add_argument(
        "--auto-switch-scan-seconds",
        type=float,
        default=3.0,
        help="Seconds between active-microphone scans when auto switch is enabled.",
    )
    parser.add_argument(
        "--auto-switch-probe-seconds",
        type=float,
        default=0.25,
        help="Probe duration (seconds) per candidate input device.",
    )
    parser.add_argument(
        "--auto-switch-max-candidates-per-scan",
        type=int,
        default=2,
        help="Maximum number of candidate microphones probed per auto-switch scan.",
    )
    parser.add_argument(
        "--exclude-device-keywords",
        default="iphone,continuity",
        help=(
            "Comma-separated case-insensitive keywords for input devices to ignore "
            "during default selection and auto-switch probing."
        ),
    )
    parser.add_argument(
        "--auto-switch-min-rms",
        type=float,
        default=0.006,
        help="Minimum RMS level for a candidate microphone to be considered active.",
    )
    parser.add_argument(
        "--auto-switch-min-ratio",
        type=float,
        default=1.8,
        help="Required loudness ratio over current mic before switching.",
    )
    parser.add_argument(
        "--auto-switch-cooldown-seconds",
        type=float,
        default=8.0,
        help="Minimum seconds between microphone switches.",
    )
    parser.add_argument(
        "--auto-switch-confirmations",
        type=int,
        default=2,
        help="Consecutive scans a device must win before switching.",
    )
    parser.add_argument(
        "--console-feedback",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Show a compact in-place recording meter in the console.",
    )
    parser.add_argument(
        "--console-feedback-hz",
        type=float,
        default=12.0,
        help="Refresh rate for console recording feedback.",
    )
    parser.add_argument(
        "--total-hours",
        type=float,
        default=24.0,
        help="Total recording duration in hours.",
    )
    parser.add_argument(
        "--segment-minutes",
        type=float,
        default=60.0,
        help="Archive segment length in minutes.",
    )
    parser.add_argument(
        "--list-devices",
        action="store_true",
        help="List available audio devices and exit.",
    )
    parser.add_argument(
        "--asr-model",
        default="Qwen/Qwen3-ASR-0.6B",
        help="Qwen3-ASR model ID or local path.",
    )
    parser.add_argument(
        "--disable-asr",
        action="store_true",
        help="Disable ASR during recording (audio only, no live transcription).",
    )
    parser.add_argument(
        "--asr-language",
        default="auto",
        help="Language name for ASR, or 'auto' to detect.",
    )
    parser.add_argument(
        "--asr-device",
        default="auto",
        help="Device map for ASR model (auto, cuda:0, mps, cpu).",
    )
    parser.add_argument(
        "--asr-dtype",
        choices=["auto", "float16", "bfloat16", "float32"],
        default="auto",
        help="Torch dtype for ASR model.",
    )
    parser.add_argument(
        "--asr-max-new-tokens",
        type=int,
        default=256,
        help="Max new tokens for ASR decoding.",
    )
    parser.add_argument(
        "--asr-max-batch-size",
        type=int,
        default=1,
        help="Max inference batch size for ASR.",
    )
    parser.add_argument(
        "--asr-preload",
        action="store_true",
        help="Load ASR model before recording starts.",
    )
    parser.add_argument(
        "--transcribe-poll-seconds",
        type=float,
        default=2.0,
        help="Polling interval for new segments.",
    )
    parser.add_argument(
        "--transcribe-settle-seconds",
        type=float,
        default=3.0,
        help="Wait time to consider a segment file stable.",
    )
    return parser


def build_transcriber(args: argparse.Namespace) -> QwenASRTranscriber:
    forced_aligner = None
    return_time_stamps = False

    transcriber = QwenASRTranscriber(
        model_name=args.asr_model,
        language=args.asr_language,
        device=args.asr_device,
        dtype=args.asr_dtype,
        max_new_tokens=args.asr_max_new_tokens,
        max_batch_size=args.asr_max_batch_size,
        forced_aligner=forced_aligner,
        return_time_stamps=return_time_stamps,
    )
    transcriber.verify_dependencies()
    if args.asr_preload:
        logging.getLogger(__name__).info("Loading ASR model...")
        transcriber.preload()
    return transcriber


def run_recording(args: argparse.Namespace) -> int:
    transcriber = None
    if not args.disable_asr:
        transcriber = build_transcriber(args)
    logging.getLogger(__name__).info(
        "Starting recording... Press Ctrl+C to stop early."
    )
    recorder = LiveVadRecorder(
        output_dir=args.output_dir,
        prefix="eve",
        device=args.device,
        vad=SileroVAD(),
        transcriber=transcriber,
    )
    recorder.config.max_segment_minutes = args.segment_minutes
    recorder.config.device_check_seconds = args.device_check_seconds
    recorder.config.device_retry_seconds = args.device_retry_seconds
    recorder.config.auto_switch_enabled = args.auto_switch_device
    recorder.config.auto_switch_scan_seconds = args.auto_switch_scan_seconds
    recorder.config.auto_switch_probe_seconds = args.auto_switch_probe_seconds
    recorder.config.auto_switch_max_candidates_per_scan = (
        args.auto_switch_max_candidates_per_scan
    )
    recorder.config.excluded_input_keywords = tuple(
        item.strip().lower()
        for item in args.exclude_device_keywords.split(",")
        if item.strip()
    )
    recorder.config.auto_switch_min_rms = args.auto_switch_min_rms
    recorder.config.auto_switch_min_ratio = args.auto_switch_min_ratio
    recorder.config.auto_switch_cooldown_seconds = args.auto_switch_cooldown_seconds
    recorder.config.auto_switch_confirmations = args.auto_switch_confirmations
    recorder.config.console_feedback_enabled = args.console_feedback
    recorder.config.console_feedback_hz = args.console_feedback_hz
    try:
        recorder.start()
        return_code = 0
    except KeyboardInterrupt:
        recorder.stop()
        logging.getLogger(__name__).info("Recording stopped.")
        return_code = 0
    finally:
        pass
    return return_code


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    init_logging()

    if args.list_devices:
        try:
            import sounddevice as sd
        except Exception:
            logging.getLogger(__name__).error(
                "sounddevice is required to list devices."
            )
            return 1
        logging.getLogger(__name__).info("%s", sd.query_devices())
        return 0

    return run_recording(args)


if __name__ == "__main__":
    raise SystemExit(main())
