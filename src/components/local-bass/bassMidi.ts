import type { Bar, PlayedNote } from './bassScore';

const ppq = 480;
const pack = (value: number, bytes: number) =>
  Array.from({ length: bytes }, (_, i) => (value >>> (8 * (bytes - i - 1))) & 255);
function delta(value: number) {
  const result = [value & 127];
  for (let next = value >>> 7; next; next >>>= 7) result.unshift((next & 127) | 128);
  return result;
}

/** A standard MIDI file with sounding pitches and a tempo map from the measured beat times. */
export function bassMidi(bars: Bar[], notes: PlayedNote[], bpm: number, meter: number): Uint8Array<ArrayBuffer> {
  const start = bars[0]?.start ?? 0;
  const end = bars.at(-1)?.end ?? start;
  const beats = [...new Set([start, ...bars.flatMap((bar) => bar.beats.map(({ time }) => time)), end])]
    .filter((beat) => beat >= start && beat <= end).sort((a, b) => a - b);
  const events: { at: number; order: number; bytes: number[] }[] = [{ at: 0, order: 1, bytes: [0xc0, 33] }];
  const tempos: number[] = [];
  for (let i = 0; i < Math.max(1, beats.length - 1); i++) {
    const seconds = beats.length > 1 ? beats[i + 1] - beats[i] : 60 / bpm;
    tempos[i] = Math.max(1, Math.min(0xffffff, Math.round(seconds * 1e6)));
    if (i === 0 || tempos[i] !== tempos[i - 1]) events.push({
      at: i * ppq, order: 0, bytes: [0xff, 0x51, 3, ...pack(tempos[i], 3)],
    });
  }
  function toTicks(seconds: number) {
    let lo = 0, hi = beats.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (beats[mid] <= seconds) lo = mid + 1;
      else hi = mid;
    }
    const beat = Math.max(0, lo - 1);
    const length = beats[beat + 1] === undefined ? 60 / bpm : beats[beat + 1] - beats[beat];
    return beat * ppq + Math.round((seconds - (beats[beat] ?? start)) / length * ppq);
  }
  let previousMeter = 0;
  for (const bar of bars) {
    const next = bar.meter ?? meter;
    if (next !== previousMeter) {
      events.push({ at: toTicks(bar.start), order: 0, bytes: [0xff, 0x58, 4, next, 2, 24, 8] });
      previousMeter = next;
    }
  }
  for (const note of notes) {
    if (note.offset <= start || note.onset >= end) continue;
    const from = toTicks(Math.max(note.onset, start));
    const to = Math.max(from + 1, toTicks(Math.min(note.offset, end)));
    events.push({ at: from, order: 3, bytes: [0x90, note.pitch, 90] },
      { at: to, order: 2, bytes: [0x80, note.pitch, 0] });
  }
  events.sort((a, b) => a.at - b.at || a.order - b.order);
  const track: number[] = [];
  let last = 0;
  for (const event of events) {
    track.push(...delta(event.at - last), ...event.bytes);
    last = event.at;
  }
  track.push(...delta(Math.max(0, toTicks(end) - last)), 0xff, 0x2f, 0);
  const header = [77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, ...pack(ppq, 2),
    77, 84, 114, 107, ...pack(track.length, 4)];
  const buffer = new Uint8Array(header.length + track.length);
  buffer.set(header); buffer.set(track, header.length);
  return buffer;
}
