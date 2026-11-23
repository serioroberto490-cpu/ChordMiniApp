"""Run the default ChordMini models directly, without Flask or a remote server."""

from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
import os
import sys


BACKEND = Path(__file__).resolve().parents[1] / "python_backend"
MODEL = BACKEND / "models" / "Chord-CNN-LSTM"


def analyze_mix(path):
    import torch

    torch.set_num_threads(min(4, os.cpu_count() or 1))
    torch.set_num_interop_threads(1)
    sys.path.insert(0, str(BACKEND))
    with redirect_stdout(sys.stderr):
        from services.detectors.madmom_detector import MadmomDetectorService
        result = MadmomDetectorService().detect_beats(str(path))
        if not result["success"]:
            raise RuntimeError(result.get("error", "Madmom failed"))

        sys.path.insert(0, str(MODEL))
        from chord_recognition import chord_recognition

        # Call real inference directly. The upstream service wrapper can emit
        # hard-coded test chords on ImportError; we must never show those as results.
        with TemporaryDirectory() as temporary:
            lab = Path(temporary) / "chords.lab"
            if not chord_recognition(str(path), str(lab), "full"):
                raise RuntimeError("Chord-CNN-LSTM inference failed")
            segments = []
            for line in lab.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    start, end, chord = line.split(maxsplit=2)
                    start, end = float(start), float(end)
                    if 0 <= start < end:
                        segments.append({"start": start, "end": end, "time": start,
                                         "chord": chord, "confidence": 1.0})
    return {"duration": round(result["duration"], 4), "beats": result["beats"], "segments": segments,
            "bpm": round(result["bpm"], 1), "candidates": result["downbeat_candidates"]}
