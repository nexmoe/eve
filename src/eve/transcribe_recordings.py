#!/usr/bin/env python3
import argparse
import json
import logging
import os
import time

from .asr.qwen import QwenASRTranscriber
from .utils.logging_utils import init_logging
from .utils.segment_utils import (
    audio_basename,
    iso_now,
    segment_start_datetime,
    segment_start_from_basename,
    transcript_path,
    write_json_atomic,
)

try:
    import soundfile as sf
except Exception as exc:  # pragma: no cover
    raise RuntimeError(
        "soundfile is required for audio inspection. Install it with `pip install soundfile`."
    ) from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Transcribe existing WAV recordings and write/update JSON transcripts. "
            "Useful for offline/asynchronous ASR after recording."
        )
    )
    parser.add_argument(
        "--input-dir",
        default="recordings",
        help="Directory to scan for WAV recordings.",
    )
    parser.add_argument(
        "--prefix",
        default="eve",
        help="Recording filename prefix (used to parse timestamps).",
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help="Continuously watch for new recordings to transcribe.",
    )
    parser.add_argument(
        "--poll-seconds",
        type=float,
        default=2.0,
        help="Polling interval when watching for new files.",
    )
    parser.add_argument(
        "--settle-seconds",
        type=float,
        default=3.0,
        help="Seconds a file must be unchanged before transcribing.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-transcribe even if a transcript already exists.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Maximum number of files to transcribe in one pass (0 = no limit).",
    )
    parser.add_argument(
        "--asr-model",
        default="Qwen/Qwen3-ASR-0.6B",
        help="Qwen3-ASR model ID or local path.",
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
        help="Load ASR model before transcription starts.",
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


def _iter_audio_files(input_dir: str):
    for root, dirs, files in os.walk(input_dir):
        dirs.sort()
        for name in sorted(files):
            if name.lower().endswith(".wav"):
                yield os.path.join(root, name)


def _audio_duration_seconds(path: str) -> float | None:
    try:
        info = sf.info(path)
    except Exception:
        return None
    if not info.samplerate:
        return None
    try:
        return info.frames / float(info.samplerate)
    except Exception:
        return None


def _is_stable(path: str, settle_seconds: float) -> bool:
    if settle_seconds <= 0:
        return True
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return False
    return (time.time() - mtime) >= settle_seconds


def _load_json(path: str) -> dict | None:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            return data
        return {}
    except FileNotFoundError:
        return None
    except Exception:
        return {}


def _already_transcribed(data: dict | None) -> bool:
    if not data:
        return False
    if data.get("status") == "ok":
        return True
    if data.get("text"):
        return True
    segments = data.get("speech_segments")
    if isinstance(segments, list):
        for seg in segments:
            if isinstance(seg, dict) and seg.get("text"):
                return True
    return False


def _ensure_base_payload(
    data: dict | None, audio_path: str, timestamp_prefix: str | None
) -> dict:
    if not data or not isinstance(data, dict):
        data = {}
    data.setdefault("audio_file", os.path.basename(audio_path))
    data.setdefault("audio_path", os.path.abspath(audio_path))
    data.setdefault("created_at", iso_now())
    if "speech_segments" not in data or not isinstance(
        data.get("speech_segments"), list
    ):
        data["speech_segments"] = []
    if timestamp_prefix:
        base = audio_basename(audio_path)
        if "segment_start" not in data:
            stamp = segment_start_from_basename(base, timestamp_prefix)
            if stamp:
                data["segment_start"] = stamp
        if "segment_start_time" not in data:
            dt = segment_start_datetime(base, timestamp_prefix)
            if dt:
                data["segment_start_time"] = dt.isoformat()
    return data


def _transcribe_file(
    transcriber: QwenASRTranscriber,
    audio_path: str,
    json_path: str,
    timestamp_prefix: str | None,
) -> None:
    logger = logging.getLogger(__name__)
    data = _load_json(json_path)
    data = _ensure_base_payload(data, audio_path, timestamp_prefix)
    duration = _audio_duration_seconds(audio_path)

    if duration is not None and duration <= 0:
        logger.warning("Skipping empty audio %s (duration=%s)", audio_path, duration)
        data["speech_segments"] = []
        data["text"] = ""
        data["language"] = None
        data["status"] = "empty_audio"
        data["model"] = transcriber.model_name
        data["backend"] = transcriber.backend
        data["asr_enabled"] = True
        data["asr_mode"] = "offline"
        data["transcribed_at"] = iso_now()
        write_json_atomic(json_path, data)
        return

    logger.info("Transcribing %s", audio_path)
    result = transcriber.transcribe(audio_path)
    text = (result.get("text") or "").strip()
    language = (result.get("language") or "").strip() or None

    segment: dict[str, object] = {
        "start_seconds": 0.0,
        "language": language,
        "text": text,
    }
    if duration is not None:
        segment["end_seconds"] = duration
    if result.get("time_stamps") is not None:
        segment["time_stamps"] = result.get("time_stamps")
    if result.get("timestamps") is not None:
        segment["timestamps"] = result.get("timestamps")

    data["speech_segments"] = [segment] if text else []
    data["text"] = text
    data["language"] = language
    data["status"] = "ok" if text else "no_text"
    data["model"] = transcriber.model_name
    data["backend"] = transcriber.backend
    data["device"] = transcriber._resolved_device
    data["dtype"] = transcriber._resolved_dtype
    data["asr_enabled"] = True
    data["asr_mode"] = "offline"
    data["transcribed_at"] = iso_now()
    write_json_atomic(json_path, data)


def _run_once(args: argparse.Namespace, transcriber: QwenASRTranscriber) -> int:
    logger = logging.getLogger(__name__)
    count = 0
    timestamp_prefix = f"{args.prefix}_live" if args.prefix else None

    for audio_path in _iter_audio_files(args.input_dir):
        if args.limit and count >= args.limit:
            break
        if not _is_stable(audio_path, args.settle_seconds):
            continue
        json_path = transcript_path(audio_path)
        existing = _load_json(json_path)
        if isinstance(existing, dict) and existing.get("status") == "recording":
            continue
        if not args.force and _already_transcribed(existing):
            continue
        try:
            _transcribe_file(transcriber, audio_path, json_path, timestamp_prefix)
        except Exception as exc:
            logger.exception("Failed to transcribe %s: %s", audio_path, exc)
            data = _ensure_base_payload(_load_json(json_path), audio_path, timestamp_prefix)
            data["speech_segments"] = []
            data["text"] = ""
            data["language"] = None
            data["status"] = "error"
            data["error"] = str(exc)
            data["model"] = transcriber.model_name
            data["backend"] = transcriber.backend
            data["asr_enabled"] = True
            data["asr_mode"] = "offline"
            data["transcribed_at"] = iso_now()
            write_json_atomic(json_path, data)
            continue
        count += 1
    return count


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    init_logging()

    transcriber = build_transcriber(args)

    if args.watch:
        while True:
            processed = _run_once(args, transcriber)
            if processed == 0:
                time.sleep(max(0.1, args.poll_seconds))
    else:
        _run_once(args, transcriber)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
