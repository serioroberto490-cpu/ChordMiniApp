import type { PreviewNote } from './bassScore';

/** A simple plucked bass for checking attacks, not a timbre model of the performance. */
export function renderBassPreview(notes: PreviewNote[], duration: number): ArrayBuffer {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 7200) throw new Error('Brano troppo lungo per l’ascolto della TAB.');
  const rate = duration > 1800 ? 12000 : 22050;
  const frames = Math.ceil(duration * rate);
  const buffer = new ArrayBuffer(44 + 2 * frames);
  const header = new DataView(buffer);
  const write = (at: number, text: string) => [...text].forEach((letter, i) => header.setUint8(at + i, letter.charCodeAt(0)));
  write(0, 'RIFF'); header.setUint32(4, buffer.byteLength - 8, true); write(8, 'WAVE');
  write(12, 'fmt '); header.setUint32(16, 16, true); header.setUint16(20, 1, true);
  header.setUint16(22, 1, true); header.setUint32(24, rate, true); header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true); header.setUint16(34, 16, true);
  write(36, 'data'); header.setUint32(40, frames * 2, true);
  const pcm = new Int16Array(buffer, 44);
  for (const note of notes) {
    const from = Math.min(frames, Math.max(0, Math.round(note.onset * rate)));
    const to = Math.min(frames, Math.round(note.offset * rate));
    const length = to - from;
    if (length < 2) continue;
    const step = 2 * Math.PI * 440 * 2 ** ((note.pitch - 69) / 12) / rate;
    const attack = Math.min(rate * 0.006, length / 3);
    const release = Math.min(rate * 0.02, length / 3);
    const decay = Math.exp(-2 / rate);
    const brightness = Math.exp(-9 / rate);
    let gain = 1, upper = 1;
    for (let i = 0; i < length; i++) {
      const phase = i * step;
      const envelope = Math.min(1, i / attack, (length - 1 - i) / release);
      const harmonic = step < Math.PI / 3 ? upper * (.28 * Math.sin(2 * phase) + .09 * Math.sin(3 * phase)) : 0;
      pcm[from + i] = Math.round(10000 * envelope * (.8 * Math.sin(phase) + harmonic) * (.55 + .45 * gain));
      gain *= decay;
      upper *= brightness;
    }
  }
  return buffer;
}
