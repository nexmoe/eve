import logging

from rich.logging import RichHandler


def init_logging(level: str = "INFO", transformers_level: str = "ERROR") -> None:
    """Configure Rich logging once for the app."""
    root = logging.getLogger()
    if root.handlers:
        return
    logging.basicConfig(
        level=level,
        format="%(message)s",
        datefmt="[%X]",
        handlers=[RichHandler(rich_tracebacks=True, show_path=False)],
    )
    logging.captureWarnings(True)
    _configure_transformers_logging(transformers_level)


def _configure_transformers_logging(level: str) -> None:
    try:
        from transformers.utils import logging as hf_logging
    except Exception:
        return

    hf_logging.disable_default_handler()
    hf_logging.enable_propagation()
    hf_logging.set_verbosity(_level_to_int(level))


def _level_to_int(level: str) -> int:
    return logging._nameToLevel.get(level.upper(), logging.INFO)
