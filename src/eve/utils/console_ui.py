from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

_console = Console()


def _abs_path(path: str) -> str:
    return str(Path(path).expanduser().resolve())


def show_recording_welcome(
    *,
    output_dir: str,
    device: str,
    asr_enabled: bool,
    asr_model: str,
    asr_preload: bool,
    segment_minutes: float,
    total_hours: float,
) -> None:
    title = Text("eve Recorder", style="bold cyan")
    summary = Table.grid(padding=(0, 1))
    summary.add_column(style="bold")
    summary.add_column()
    summary.add_row("Output", _abs_path(output_dir))
    summary.add_row("Device", str(device))
    summary.add_row("ASR", "enabled" if asr_enabled else "disabled")
    if asr_enabled:
        summary.add_row("Model", asr_model)
        summary.add_row("ASR preload", "on" if asr_preload else "off (lazy load)")
    summary.add_row("Segment", f"{segment_minutes:g} min")
    summary.add_row("Duration", f"{total_hours:g} h")

    tips = []
    if asr_enabled and not asr_preload:
        tips.append(
            "First transcription can be slow if the model is not cached locally."
        )
    if asr_enabled and asr_preload:
        tips.append(
            "Preloading may take several minutes on first run while model files download."
        )
    tips.append("Press Ctrl+C to stop.")

    body = Table.grid(padding=(1, 0))
    body.add_row(title)
    body.add_row(summary)
    body.add_row(Text("\n".join(f"- {line}" for line in tips), style="dim"))
    _console.print(
        Panel.fit(
            body,
            border_style="cyan",
            title="[bold]Welcome[/bold]",
        )
    )


def show_transcribe_welcome(
    *,
    input_dir: str,
    watch: bool,
    asr_model: str,
    asr_preload: bool,
) -> None:
    title = Text("eve Transcribe", style="bold green")
    summary = Table.grid(padding=(0, 1))
    summary.add_column(style="bold")
    summary.add_column()
    summary.add_row("Input", _abs_path(input_dir))
    summary.add_row("Mode", "watch" if watch else "single pass")
    summary.add_row("Model", asr_model)
    summary.add_row("ASR preload", "on" if asr_preload else "off (lazy load)")

    tips = []
    if not asr_preload:
        tips.append(
            "First file may start slowly if the ASR model is not cached locally."
        )
    if asr_preload:
        tips.append(
            "Preloading may take several minutes on first run while model files download."
        )

    body = Table.grid(padding=(1, 0))
    body.add_row(title)
    body.add_row(summary)
    if tips:
        body.add_row(Text("\n".join(f"- {line}" for line in tips), style="dim"))
    _console.print(
        Panel.fit(
            body,
            border_style="green",
            title="[bold]Welcome[/bold]",
        )
    )


@contextmanager
def startup_status(message: str):
    with _console.status(f"[bold]{message}[/bold]", spinner="dots"):
        yield
