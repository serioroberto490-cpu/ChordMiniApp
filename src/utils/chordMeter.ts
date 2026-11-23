/** ChordMini's heuristic: prefer chord changes on downbeats (or strong beats in 4/4). */
export function scoreDownbeatAlignment(chords: string[], meter: number) {
  const valid = (chord: string) => chord && !['N', 'N/C', 'N.C.'].includes(chord);
  const changes = chords.flatMap((chord, i) => i > 0 && valid(chord) && valid(chords[i - 1]) &&
    chord !== chords[i - 1] ? [i] : []);
  let score = -Infinity;
  let bestShift = 0;
  for (let shift = 0; shift < meter; shift++) {
    const down = changes.filter((i) => (i - shift) % meter === 0).length;
    let candidate = 3 * down - changes.length;
    if (meter === 4) {
      const half = changes.filter((i) => (i - shift) % 2 === 0).length;
      candidate = Math.max(candidate, (3 * half - changes.length) * 0.5);
    }
    if (candidate > score) { score = candidate; bestShift = shift; }
  }
  return { score: Number.isFinite(score) ? score : 0, bestShift };
}
