"""Leo's voice: natural on-device speech.

Engines, best first:
  * neural  Kokoro-82M (Apache-2.0) via kokoro-onnx, fp16 model in .models/ (fetched by setup).
            ~0.2 s of compute per second of speech on Apple Silicon; fully offline.
  * system  macOS `say` (used only when the neural voice is not installed).
The buddy page plays the returned WAV with a slightly raised playback rate (the "cub" pitch);
the speech rate is compensated here so the final tempo matches the chosen speed.

Lines are pre-rendered the moment the coach creates a message, so by the time the speech
bubble has typed itself out the audio is usually ready.
"""
from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import io
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import wave
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Optional

logger = logging.getLogger("viveka.voice")

MODEL_FILE = "kokoro-v1.0.fp16.onnx"
VOICES_FILE = "voices-v1.0.bin"
DEFAULT_VOICE = "af_heart"
SYSTEM_VOICE = "system"

# (id, label) shown in Settings. All Kokoro voices work; these are the friendly picks.
VOICE_CHOICES: tuple[tuple[str, str], ...] = (
    ("af_heart", "Heart: warm and natural (recommended)"),
    ("am_puck", "Puck: playful"),
    ("af_bella", "Bella: bright and bubbly"),
    ("am_michael", "Michael: calm"),
    ("am_fenrir", "Fenrir: bold"),
    ("af_nicole", "Nicole: soft, almost a whisper"),
    ("bf_emma", "Emma: British, gentle"),
    ("bm_george", "George: British, wise"),
    ("hf_alpha", "Alpha: Indian accent (experimental)"),
    ("hm_omega", "Omega: Indian accent (experimental)"),
    (SYSTEM_VOICE, "macOS system voice"),
)

# Messages Leo reads out when "speak: important" is chosen (the buddy page uses the same set).
IMPORTANT_KINDS = frozenset({"greeting", "nudge", "distraction", "stall", "break", "back", "info", "chat"})

_EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿️‍]")
_SENTENCE = re.compile(r"(?<=[.!?])\s+")


class VoiceUnavailable(RuntimeError):
    pass


# ----------------------------------------------------------------------------- text
def speech_text(kind: str, title: str, text: str) -> str:
    """What Leo says out loud for a message (titles help: "Wrong tab? Hmm, ...")."""
    if kind == "quote":
        spoken = f"Swamiji says: {text}"
    elif kind == "fact":
        spoken = f"Did you know? {text}"
    elif kind in ("nudge", "stall") and title:
        spoken = f"{title} {text}"
    else:
        spoken = text
    spoken = _EMOJI.sub("", spoken)
    spoken = spoken.replace("...", ", ").replace("…", ", ").replace("—", ", ").replace("–", ", ")
    spoken = re.sub(r'["“”]', "", spoken)
    # acronyms are spelled out ("DSA" -> "D S A"); periods would also break sentence splitting
    spoken = re.sub(r"\b([A-Z]{2,4})\b", lambda m: " ".join(m.group(1)) if m.group(1) not in ("OK",) else m.group(1), spoken)
    return re.sub(r"\s+", " ", spoken).strip()


def speech_chunks(spoken: str, min_len: int = 28, max_chunks: int = 4) -> list[str]:
    """Split into sentences (merged when tiny) so the first one can start playing quickly."""
    if not spoken:
        return []
    parts = [p.strip() for p in _SENTENCE.split(spoken) if p.strip()]
    chunks: list[str] = []
    for part in parts:
        if chunks and (len(chunks[-1]) < min_len or len(chunks) >= max_chunks):
            chunks[-1] = f"{chunks[-1]} {part}"
        else:
            chunks.append(part)
    return [c[:400] for c in chunks]


def effective_speed(speed: float, pitch_percent: float) -> float:
    """Playback is sped up by (1 + pitch) to raise the pitch, so synthesize correspondingly slower."""
    rate = 1.0 + pitch_percent / 100.0
    return round(min(2.0, max(0.5, speed / rate)), 3)


# ------------------------------------------------------------------------- helpers
def _wav_bytes(samples: object, sample_rate: int) -> bytes:
    import numpy as np  # only needed for the neural engine

    pcm = (np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def _short_espeak_data(data_path: str) -> str:
    """espeak-ng copies its data path into a ~160-byte buffer and silently falls back to a path baked
    in at build time when it is longer (deep checkouts). Use a real copy at a short path then.
    (A symlink is not enough: phonemizer resolves it back to the long path.)"""
    if len(data_path) <= 120:
        return data_path
    for base in (Path.home() / "Library" / "Caches" / "viveka", Path.home() / ".cache" / "viveka",
                 Path(tempfile.gettempdir()) / "viveka"):
        target = base / "espeak-ng-data"
        if len(str(target)) > 120:
            continue
        marker = target / ".source"
        try:
            if not (marker.exists() and marker.read_text() == data_path):
                if target.exists():
                    shutil.rmtree(target)
                shutil.copytree(data_path, target)
                marker.write_text(data_path)
            return str(target)
        except OSError:
            continue
    return data_path


def _say_wav(text: str, speed: float) -> bytes:
    if sys.platform != "darwin" or not shutil.which("say"):
        raise VoiceUnavailable("no speech engine available")
    voices = subprocess.run(["say", "-v", "?"], capture_output=True, text=True, timeout=10).stdout
    name = next((v for v in ("Samantha", "Karen", "Daniel", "Rishi") if re.search(rf"^{v}\s", voices, re.M)), None)
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "speech.wav"
        cmd = ["say", "-r", str(int(185 * speed)), "-o", str(out), "--file-format=WAVE", "--data-format=LEI16@22050"]
        if name:
            cmd[1:1] = ["-v", name]
        subprocess.run([*cmd, text], check=True, capture_output=True, timeout=30)
        return out.read_bytes()


# --------------------------------------------------------------------------- engine
class Voice:
    def __init__(self, models_dir: str | Path, cache_size: int = 96) -> None:
        self.models_dir = Path(models_dir)
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="viveka-voice")  # espeak is not thread-safe
        self._kokoro: object = None
        self._load_error = ""
        self._load_failed_at = 0.0
        self._cache: OrderedDict[str, bytes] = OrderedDict()
        self._inflight: dict[str, Future[bytes]] = {}
        self._lock = threading.Lock()
        self._cache_size = cache_size

    # ---- status
    def neural_installed(self) -> bool:
        if not ((self.models_dir / MODEL_FILE).is_file() and (self.models_dir / VOICES_FILE).is_file()):
            return False
        if importlib.util.find_spec("kokoro_onnx") is None:
            importlib.invalidate_caches()  # may have been installed while we run (start.sh installs it in the background)
            return importlib.util.find_spec("kokoro_onnx") is not None
        return True

    def engine(self) -> str:
        if self.neural_installed() and not (self._load_failed_at and time.time() - self._load_failed_at < 60):
            return "neural"
        if sys.platform == "darwin" and shutil.which("say"):
            return "system"
        return "none"

    def status(self) -> dict[str, object]:
        engine = self.engine()
        return {
            "engine": engine,
            "neuralInstalled": self.neural_installed(),
            "loaded": self._kokoro is not None,
            "error": self._load_error or None,
            "defaultVoice": DEFAULT_VOICE,
            "voices": [{"id": v, "label": label} for v, label in VOICE_CHOICES
                       if engine == "neural" or v == SYSTEM_VOICE],
        }

    # ---- rendering (worker thread)
    def _load(self) -> object:
        if self._kokoro is not None:
            return self._kokoro
        try:
            import espeakng_loader
            from kokoro_onnx import EspeakConfig, Kokoro

            data = _short_espeak_data(espeakng_loader.get_data_path())
            self._kokoro = Kokoro(str(self.models_dir / MODEL_FILE), str(self.models_dir / VOICES_FILE),
                                  espeak_config=EspeakConfig(data_path=data))
            self._load_error = ""
            logger.info("neural voice loaded")
        except Exception as exc:  # broken install, missing files, ...: fall back to the system voice
            self._load_failed_at = time.time()
            self._load_error = f"{exc.__class__.__name__}: {exc}"[:200]
            logger.warning("neural voice unavailable: %s", self._load_error)
            raise
        return self._kokoro

    def _render(self, text: str, voice: str, speed: float) -> bytes:
        if voice != SYSTEM_VOICE and self.engine() == "neural":
            try:
                kokoro = self._load()
                names = kokoro.get_voices()  # type: ignore[attr-defined]
                samples, sample_rate = kokoro.create(text, voice=voice if voice in names else DEFAULT_VOICE,  # type: ignore[attr-defined]
                                                     speed=speed, lang="en-us")
                return _wav_bytes(samples, sample_rate)
            except Exception:
                logger.exception("neural synthesis failed; using the system voice")
        return _say_wav(text, speed)

    # ---- public API
    @staticmethod
    def _key(text: str, voice: str, speed: float) -> str:
        return hashlib.sha1(f"{voice}|{speed:.3f}|{text}".encode()).hexdigest()

    def submit(self, text: str, voice: str, speed: float) -> Future[bytes]:
        key = self._key(text, voice, speed)
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                done: Future[bytes] = Future()
                done.set_result(self._cache[key])
                return done
            if key in self._inflight:
                return self._inflight[key]
            fut = self._pool.submit(self._render, text, voice, speed)
            self._inflight[key] = fut

        def remember(f: Future[bytes]) -> None:
            with self._lock:
                self._inflight.pop(key, None)
                if not f.cancelled() and f.exception() is None:
                    self._cache[key] = f.result()
                    while len(self._cache) > self._cache_size:
                        self._cache.popitem(last=False)

        fut.add_done_callback(remember)
        return fut

    async def speak(self, text: str, voice: str, speed: float) -> bytes:
        if self.engine() == "none":
            raise VoiceUnavailable("no speech engine available")
        return await asyncio.wrap_future(self.submit(text, voice, speed))

    def prefetch(self, chunks: list[str], voice: str, speed: float) -> None:
        if self.engine() == "none":
            return
        for chunk in chunks:
            self.submit(chunk, voice, speed)

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)


_voice: Optional[Voice] = None


def get_voice() -> Voice:
    global _voice
    if _voice is None:
        from config import get_settings

        _voice = Voice(get_settings().models_dir)
    return _voice


def reset_voice(voice: Optional[Voice] = None) -> None:
    global _voice
    if _voice is not None and _voice is not voice:
        _voice.shutdown()
    _voice = voice
