"""Offline analysis of the original mix and an isolated electric bass."""

import numpy as np
import soundfile as sf
from scipy import fft, ndimage, signal


SR = 11025
HOP = 110
def load_audio(path):
    audio, sr = sf.read(path, dtype="float32", always_2d=True)
    if not len(audio):
        raise ValueError("Il file audio è vuoto.")
    duration = len(audio) / sr
    # Some stems are much quieter on one side. Weight the stereo mean normally,
    # but use the stronger channel if summing would largely cancel the signal.
    mono = audio.mean(axis=1)
    if audio.shape[1] > 1 and np.max(np.abs(mono)) < 0.45 * np.max(np.abs(audio)):
        mono = audio[:, np.argmax(np.mean(audio**2, axis=0))]
    if sr != SR:
        from math import gcd

        divisor = gcd(sr, SR)
        mono = signal.resample_poly(mono, SR // divisor, sr // divisor)
    return mono, duration


def bass_notes(audio):
    """Batched YIN with octave checks, energy gating and short-note cleanup."""
    audio = signal.sosfiltfilt(
        signal.butter(3, [28, 1250], btype="bandpass", fs=SR, output="sos"), audio
    ).astype(np.float32)
    win = 1024
    low, high = int(SR / 410), int(SR / 30)
    frames = np.lib.stride_tricks.sliding_window_view(
        np.pad(audio, (win // 2, win // 2)), win
    )[::HOP]
    rms = np.sqrt(np.einsum("ij,ij->i", frames, frames) / win)
    if rms.max(initial=0) < 1e-6:
        return []
    gate = max(1e-6, np.quantile(rms, 0.90) * 0.075)
    pitches = np.zeros(len(frames), dtype=np.int16)
    strengths = np.zeros(len(frames))
    for start in range(0, len(frames), 256):
        batch = frames[start:start + 256]
        spectrum = fft.rfft(batch, n=2 * win)
        corr = fft.irfft(np.abs(spectrum)**2)[:, :high + 1]
        sums = np.pad(np.cumsum(batch**2, axis=1), ((0, 0), (1, 0)))
        lag = np.arange(high + 1)
        delta = np.maximum(0, sums[:, win - lag] + sums[:, -1:] - sums[:, lag] - 2 * corr)
        yin = delta[:, 1:] * lag[1:] / np.maximum(np.cumsum(delta[:, 1:], axis=1), 1e-12)
        for i, row in enumerate(yin, start):
            if rms[i] < gate:
                continue
            minima = np.flatnonzero((row[1:-1] < row[:-2]) & (row[1:-1] <= row[2:])) + 1
            candidates = minima[minima >= low - 1]
            if not len(candidates):
                continue
            best = candidates[np.argmin(row[candidates])]
            good = candidates[row[candidates] < min(0.23, row[best] + 0.095)]
            x = int(good[0] if len(good) else best)
            # Prefer the longer period if it is substantially cleaner and ~one octave lower.
            double = candidates[np.abs((candidates + 1) / (x + 1) - 2) < 0.07]
            if len(double) and row[x] - row[double[0]] > 0.075:
                x = int(double[0])
            if row[x] > 0.43:
                continue
            left, middle, right = row[x - 1:x + 2]
            curve = left - 2 * middle + right
            period = x + 1 + (0.5 * (left - right) / curve if curve > 1e-9 else 0)
            pitches[i] = round(69 + 12 * np.log2(SR / period / 440))
            strengths[i] = 1 - row[x]
    # Mend isolated flicker (including tiny dropouts) without stretching across rests.
    for i in range(2, len(pitches) - 2):
        if pitches[i - 2] == pitches[i + 2] and pitches[i - 1] == pitches[i + 1]:
            if pitches[i - 1] and pitches[i - 1] == pitches[i - 2]:
                pitches[i] = pitches[i - 1]
    bounds = np.r_[0, np.flatnonzero(np.diff(pitches)) + 1, len(pitches)]
    notes = []
    for begin, end in zip(bounds[:-1], bounds[1:]):
        pitch = int(pitches[begin])
        if not pitch or end - begin < 6:
            continue
        # Split a sustained pitch on a clear new attack (important for repeated notes).
        envelope = ndimage.gaussian_filter1d(rms[begin:end], 1)
        changes = np.r_[0, np.maximum(np.diff(np.log(np.maximum(envelope, gate / 3))), 0)]
        peaks, _ = signal.find_peaks(changes, height=0.34, distance=9)
        cuts = [begin]
        for point in peaks:
            if begin + point - cuts[-1] >= 8 and end - begin - point >= 7:
                cuts.append(begin + int(point))
        cuts.append(end)
        for start, stop in zip(cuts[:-1], cuts[1:]):
            notes.append({
                "onset": round(max(0, (start - 0.5) * HOP / SR), 4),
                "offset": round(min(len(audio) / SR, (stop - 0.5) * HOP / SR), 4),
                "pitch": pitch,
                "confidence": round(float(np.mean(strengths[start:stop])), 2),
            })
    return notes


def analyze(path):
    audio, duration = load_audio(path)
    return {"duration": round(duration, 4), "notes": bass_notes(audio)}
