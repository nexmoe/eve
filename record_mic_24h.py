#!/usr/bin/env python3
import argparse
import os
import shutil
import subprocess
import sys


def get_ffmpeg_path() -> str:
    env_path = os.environ.get("FFMPEG_PATH")
    if env_path:
        if os.path.isfile(env_path) and os.access(env_path, os.X_OK):
            return env_path
        sys.exit(f"FFMPEG_PATH is set but not executable: {env_path}")

    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path:
        return ffmpeg_path

    sys.exit(
        "ffmpeg not found. Install it (e.g., `brew install ffmpeg`) "
        "or set FFMPEG_PATH to the ffmpeg binary."
    )


def list_devices() -> int:
    ffmpeg = get_ffmpeg_path()
    # On macOS, avfoundation lists audio devices with indexes; use :<audio_index>
    cmd = [ffmpeg, "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    lines = []
    if result.stdout:
        lines.extend(result.stdout.splitlines())
    if result.stderr:
        lines.extend(result.stderr.splitlines())

    for line in lines:
        if (
            "Error opening input file" in line
            or "Error opening input files" in line
            or "Input/output error" in line
        ):
            continue
        print(line)

    # ffmpeg returns non-zero when listing devices; treat as success.
    return 0


def build_ffmpeg_cmd(args: argparse.Namespace) -> list[str]:
    ffmpeg = get_ffmpeg_path()

    total_seconds = int(args.total_hours * 3600)
    segment_seconds = int(args.segment_minutes * 60)

    os.makedirs(args.output_dir, exist_ok=True)

    filename = os.path.join(
        args.output_dir, f"{args.prefix}_%Y%m%d_%H%M%S.m4a"
    )

    return [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "warning",
        "-f",
        "avfoundation",
        "-i",
        args.device,
        "-t",
        str(total_seconds),
        "-ac",
        str(args.channels),
        "-ar",
        str(args.sample_rate),
        "-c:a",
        "aac",
        "-b:a",
        args.bitrate,
        "-f",
        "segment",
        "-segment_time",
        str(segment_seconds),
        "-reset_timestamps",
        "1",
        "-strftime",
        "1",
        filename,
    ]


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Record system microphone continuously for 24 hours and archive in segments. "
            "Set FFMPEG_PATH to override the ffmpeg binary."
        )
    )
    parser.add_argument(
        "--device",
        default=":0",
        help=(
            "avfoundation audio device (default :0). "
            "Use --list-devices to discover device indexes."
        ),
    )
    parser.add_argument(
        "--output-dir",
        default="recordings",
        help="Directory to store audio segments.",
    )
    parser.add_argument(
        "--prefix",
        default="mic",
        help="Filename prefix for segments.",
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
        "--bitrate",
        default="128k",
        help="Audio bitrate for AAC encoding.",
    )
    parser.add_argument(
        "--sample-rate",
        type=int,
        default=48000,
        help="Audio sample rate (Hz).",
    )
    parser.add_argument(
        "--channels",
        type=int,
        default=1,
        help="Number of audio channels.",
    )
    parser.add_argument(
        "--list-devices",
        action="store_true",
        help="List available audio devices and exit.",
    )

    args = parser.parse_args()

    if args.list_devices:
        return list_devices()

    cmd = build_ffmpeg_cmd(args)
    print("Starting 24h recording... Press Ctrl+C to stop early.")
    print("Command:")
    print(" ".join(cmd))

    try:
        return subprocess.call(cmd)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
