import { getBassNoteFromInversion } from '@/utils/chordFormatting/inversions';
import { renderMusicXmlHarmony } from '@/utils/musicXmlExport/shared';

export type BassNote = { onset: number; offset: number; pitch: number; confidence: number };
export type BassAnalysis = { duration: number; notes: BassNote[] };
export type MixAnalysis = { duration: number; beats: number[]; chords: string[]; bpm: number | null; downbeat: number;
  meter?: number; chordModel?: string; beatModel?: string; grid?: {
    beats: (number | null)[]; chords: string[];
    metricSegments?: { startIndex: number; endIndex: number; beatsPerMeasure: number }[];
  } };
export type Position = { string: number; fret: number };
export type Bar = { start: number; end: number; beats: { time: number; chord: string }[]; pickup: boolean; meter?: number };
export type Edit = { pitch?: number; position?: Position; hidden?: boolean; offset?: number };
export type PlayedNote = BassNote & { id: number; choice?: Position; position?: Position };

export const tunings = {
  standard: { label: '4 corde · E A D G', strings: [43, 38, 33, 28] },
  five: { label: '5 corde · B E A D G', strings: [43, 38, 33, 28, 23] },
  drop: { label: 'Drop D · D A D G', strings: [43, 38, 33, 26] },
};
export type Tuning = keyof typeof tunings;
export const pitchName = (pitch: number) =>
  ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'][pitch % 12] + (Math.floor(pitch / 12) - 1);

export function getPositions(pitch: number, tuning: Tuning): Position[] {
  return tunings[tuning].strings.flatMap((open, string) => {
    const fret = pitch - open;
    return fret >= 0 && fret <= 24 ? [{ string, fret }] : [];
  });
}

export function fingerNotes(notes: BassNote[], edits: Record<number, Edit>, tuning: Tuning): PlayedNote[] {
  const visible: PlayedNote[] = notes.flatMap((note, id) => {
    const edit = edits[id];
    if (edit?.hidden) return [];
    return [{ ...note, id, pitch: edit?.pitch ?? note.pitch, offset: edit?.offset ?? note.offset, choice: edit?.position }];
  });
  const options = visible.map((note) => {
    const available = getPositions(note.pitch, tuning);
    const locked = available.find((p) => p.string === note.choice?.string && p.fret === note.choice?.fret);
    return locked ? [locked] : available;
  });
  type Path = { position: Position; hand: number; cost: number; prev?: Path };
  let previous: Path[] = [];
  let last = -1;
  const finish = () => {
    let path: Path | undefined = previous.reduce<Path | undefined>((best, candidate) =>
      !best || candidate.cost < best.cost ? candidate : best, undefined);
    for (let i = last; path; i--, path = path.prev) visible[i].position = path.position;
    previous = [];
  };
  options.forEach((positions, i) => {
    if (!positions.length || (i > 0 && visible[i].onset - visible[i - 1].offset >= 0.6)) finish();
    if (!positions.length) return;
    const next = new Map<string, Path>();
    for (const prev of previous.length ? previous : [undefined]) {
      const nearFretted = prev && prev.hand > 2 && positions.some(({ fret, string }) =>
        fret > 0 && Math.abs(fret - prev.hand) <= 2 && Math.abs(string - prev.position.string) <= 1);
      for (const position of positions) {
        const { fret, string } = position;
        // Playing an open string doesn't move the fretting hand to fret zero.
        const hand = fret || prev?.hand || 0;
        const distance = fret && prev?.hand ? Math.abs(fret - prev.hand) : 0;
        const jump = prev ? Math.abs(string - prev.position.string) : 0;
        const local = fret * 0.06 + Math.max(0, fret - 14) * 0.18;
        const cost = (prev?.cost ?? 0) + local + distance * 1.1 + jump * 0.35 +
          (!fret && nearFretted ? 4 : 0);
        const key = `${string}:${hand}`;
        const saved = next.get(key);
        if (!saved || cost < saved.cost) next.set(key, { position, hand, cost, prev });
      }
    }
    previous = [...next.values()];
    last = i;
  });
  finish();
  return visible;
}

export function mergeBassNotes(notes: PlayedNote[], edits: Record<number, Edit>, id: number) {
  const index = notes.findIndex((note) => note.id === id);
  if (index <= 0) return null;
  const previous = notes[index - 1];
  const selected = notes[index];
  return {
    id: previous.id,
    edits: {
      ...edits,
      [previous.id]: { ...edits[previous.id], offset: Math.max(previous.offset, selected.offset) },
      [id]: { ...edits[id], hidden: true },
    },
  };
}

export function getBars(mix: MixAnalysis, firstBeat: number, meter: number): Bar[] {
  const pairs = mix.beats.map((time, i) => ({ time, chord: mix.chords[i] ?? '—' }))
    .filter(({ time }) => time >= 0 && time < mix.duration);
  if (pairs.length < 2) return [{ start: 0, end: mix.duration, beats: [], pickup: false }];
  const first = Math.max(0, Math.min(firstBeat, pairs.length - 1));
  const indexes = pairs.map((_, i) => i).filter((i) => i >= first && (i - first) % meter === 0);
  const start = pairs[indexes[0]].time;
  const bars: Bar[] = start > 0.04
    ? [{ start: 0, end: start, beats: pairs.slice(0, indexes[0]), pickup: true }]
    : [];
  for (let i = 0; i < indexes.length; i++) {
    const from = indexes[i];
    const to = indexes[i + 1] ?? pairs.length;
    bars.push({ start: i === 0 && !bars.length ? 0 : pairs[from].time, end: pairs[to]?.time ?? mix.duration,
      beats: pairs.slice(from, to), pickup: false });
  }
  return bars;
}

export function getChordMiniBars(mix: MixAnalysis): Bar[] {
  const meter = mix.meter ?? 4;
  const grid = mix.grid;
  if (!grid?.beats.length) return getBars(mix, mix.downbeat, meter);
  const groups: Omit<Bar, 'end'>[] = [];
  for (let index = 0; index < grid.beats.length;) {
    const segment = grid.metricSegments?.find(({ startIndex, endIndex }) => startIndex <= index && index < endIndex);
    const beatsPerBar = Math.max(1, segment?.beatsPerMeasure ?? meter);
    const next = Math.min(index + beatsPerBar, segment?.endIndex ?? grid.beats.length);
    const beats = grid.beats.slice(index, next).flatMap((time, j) =>
      time !== null && time >= 0 && time < mix.duration ? [{ time, chord: grid.chords[index + j] || 'N/C' }] : []);
    if (beats.length && (groups.at(-1)?.start ?? -1) < beats[0].time) {
      groups.push({ beats, start: beats[0].time, meter: beatsPerBar, pickup: false });
    }
    index = next;
  }
  if (!groups.length) return getBars(mix, mix.downbeat, meter);
  if (groups[0].start > 0.04) groups.unshift({ beats: [], start: 0, pickup: true, meter: groups[0].meter });
  else groups[0].start = 0;
  return groups.map((group, i) => ({ ...group, end: groups[i + 1]?.start ?? mix.duration }));
}

export function barAtTime(bars: Bar[], time: number) {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (bars[mid].start <= time) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

export function tabLayout(bar: Bar, notes: { onset: number }[], zoom: number) {
  // Preserve the timeline, but add room between close attacks instead of
  // drawing unclickable overlapping fret numbers.
  const span = Math.max(0.01, bar.end - bar.start);
  const anchors = [{ time: bar.start, x: 16 }];
  const minGap = 23;
  const scale = Math.max(85, 215 / span) * zoom;
  let lastNote = -Infinity;
  for (const note of notes) {
    if (note.onset < bar.start || note.onset >= bar.end) continue;
    const nominal = anchors.at(-1)!.x + (note.onset - anchors.at(-1)!.time) * scale;
    const x = Math.max(nominal, lastNote + minGap);
    if (note.onset > anchors.at(-1)!.time) anchors.push({ time: note.onset, x });
    lastNote = x;
  }
  const last = anchors.at(-1)!;
  const width = Math.ceil(last.x + Math.max(21, (bar.end - last.time) * scale));
  anchors.push({ time: bar.end, x: width });
  return {
    width,
    at(time: number) {
      if (time < bar.start) return 0;
      const i = anchors.findIndex((point) => point.time > time);
      if (i < 1) return width;
      const a = anchors[i - 1];
      const b = anchors[i];
      return a.x + (b.x - a.x) * (time - a.time) / (b.time - a.time);
    },
  };
}

export function mixGains(mix: number, bass: number, hasBass: boolean): [number, number] {
  // Keep the requested balance, with headroom when the same bass is in both tracks.
  const isolated = hasBass ? bass : 0;
  const scale = Math.max(100, mix + isolated);
  return [mix / scale, isolated / scale];
}

function notePitch(pitch: number) {
  const [step, alter] = ['C0', 'C1', 'D0', 'E-1', 'E0', 'F0', 'F1', 'G0', 'A-1', 'A0', 'B-1', 'B0'][pitch % 12].match(/^(.)(.+)$/)!.slice(1);
  return `<pitch><step>${step}</step>${alter === '0' ? '' : `<alter>${alter}</alter>`}<octave>${Math.floor(pitch / 12) - 1}</octave></pitch>`;
}

const divisions = 8;
const values = [[32, 'whole', false], [24, 'half', true], [16, 'half', false], [12, 'quarter', true],
  [8, 'quarter', false], [6, 'eighth', true], [4, 'eighth', false], [3, '16th', true], [2, '16th', false],
  [1, '32nd', false]] as const;
export type RhythmValue = typeof values[number][1];
export type RhythmMark = { onset: number; end: number; ticks: number; value: RhythmValue;
  dotted: boolean; note?: PlayedNote; tiedFrom: boolean; tiedTo: boolean };

export function isChordBassTarget(chord: string | undefined, pitch: number) {
  const parts = chord?.match(/^([A-G][b#♭♯]{0,2})([^/]*)(?:\/([^/]+))?$/);
  if (!parts) return false;
  const [, rootName, quality, inversion] = parts;
  const target = inversion ? getBassNoteFromInversion(rootName, quality.replace(/^:/, ''),
    inversion.replace(/♭/g, 'b').replace(/♯/g, '#')) : rootName;
  return pitchClass(target) === pitch % 12;
}

function pitchClass(note: string) {
  const match = note.match(/^([A-G])([b#♭♯]{0,2})$/);
  if (!match) return -1;
  const root = [9, 11, 0, 2, 4, 5, 7][match[1].charCodeAt(0) - 65];
  const shift = [...match[2]].reduce((n, sign) => n + (sign === '#' || sign === '♯' ? 1 : -1), 0);
  return (root + shift + 12) % 12;
}

const degreeLabels = ['1', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7'];
const degreeColors = ['#abc3e5', '#ffb48a', '#6ee3bd', '#ff9fa8', '#8edaf8', '#f8d57b',
  '#ffb0cd', '#b7e78d', '#f2acb3', '#eed6a6', '#aabaff', '#f2a5e0'];
export function chordDegree(chord: string | undefined, pitch: number) {
  const match = chord?.match(/^([A-G][b#♭♯]{0,2})([^/]*)/);
  if (!match) return null;
  const semitone = (pitch % 12 - pitchClass(match[1]) + 12) % 12;
  const quality = match[2].replace(/^:/, '');
  const alteredFifth = semitone === 6 && /dim|hdim|ø|°|b5/i.test(quality) ? '♭5'
    : semitone === 8 && /aug|^\+|#5/i.test(quality) ? '♯5' : null;
  return { label: alteredFifth ?? degreeLabels[semitone], color: degreeColors[semitone] };
}

export function rhythmForBar(bar: Bar, notes: PlayedNote[], meter: number, bpm: number): RhythmMark[] {
  const barMeter = bar.meter ?? meter;
  const ticks = bar.pickup ? Math.max(1, Math.round((bar.end - bar.start) * bpm / 60 * divisions)) : barMeter * divisions;
  const grid = [bar.start, ...bar.beats.map((beat) => beat.time)
    .filter((time) => time - bar.start > 0.04 && time < bar.end), bar.end];
  const useBeatLengths = !bar.pickup && grid.length === barMeter + 1;
  const tick = (time: number) => {
    if (useBeatLengths) {
      const index = Math.max(0, grid.findIndex((boundary, j) => j > 0 && time <= boundary) - 1);
      return Math.round(divisions * (index + (time - grid[index]) / (grid[index + 1] - grid[index])));
    }
    return Math.round((time - bar.start) / (bar.end - bar.start) * ticks);
  };
  const at = (index: number) => {
    if (index >= ticks) return bar.end;
    if (!useBeatLengths) return bar.start + (bar.end - bar.start) * index / ticks;
    const beat = Math.floor(index / divisions);
    return grid[beat] + (grid[beat + 1] - grid[beat]) * (index % divisions) / divisions;
  };
  const marks: RhythmMark[] = [];
  const add = (from: number, to: number, note?: PlayedNote) => {
    for (let start = from; start < to;) {
      const [size, value, dotted] = values.find(([len]) => len <= to - start)!;
      const end = start + size;
      marks.push({ onset: at(start), end: at(end), ticks: size, value, dotted, note,
        tiedFrom: !!note && (start > from || note.onset < bar.start),
        tiedTo: !!note && (end < to || note.offset > bar.end) });
      start = end;
    }
  };
  let position = 0;
  let lo = 0, hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid].offset <= bar.start) lo = mid + 1;
    else hi = mid;
  }
  for (let index = lo; index < notes.length; index++) {
    const note = notes[index];
    if (note.onset >= bar.end) break;
    if (note.offset <= bar.start) continue;
    const start = Math.max(position, Math.min(ticks - 1, tick(Math.max(bar.start, note.onset))));
    if (start >= ticks) break;
    const end = Math.min(ticks, Math.max(start + 1, tick(Math.min(bar.end, note.offset))));
    add(position, start);
    add(start, end, note);
    position = end;
  }
  add(position, ticks);
  return marks;
}

export type PreviewNote = { onset: number; offset: number; pitch: number };
export function tabPreviewNotes(bars: Bar[], notes: PlayedNote[], meter: number, bpm: number): PreviewNote[] {
  const preview: PreviewNote[] = [];
  let lastId: number | undefined;
  for (const bar of bars) {
    for (const mark of rhythmForBar(bar, notes, meter, bpm)) {
      const previous = preview.at(-1);
      if (!mark.note) { lastId = undefined; continue; }
      if (mark.tiedFrom && previous && lastId === mark.note.id && Math.abs(mark.onset - previous.offset) < 0.0001) {
        previous.offset = mark.end;
      } else {
        preview.push({ onset: mark.onset, offset: mark.end, pitch: mark.note.pitch });
      }
      lastId = mark.note.id;
    }
  }
  return preview;
}

export function bassMusicXml(bars: Bar[], notes: PlayedNote[], meter: number, bpm: number, firstNumber: number,
  chordLabel?: (chord: string) => string) {
  const measures = bars.map((bar, i) => {
    const barMeter = bar.meter ?? meter;
    const timing = `<time><beats>${barMeter}</beats><beat-type>4</beat-type></time>`;
    let body = i === 0 ? `<attributes><divisions>${divisions}</divisions>${timing}<clef><sign>F</sign><line>4</line></clef><transpose><chromatic>0</chromatic><octave-change>-1</octave-change></transpose></attributes><sound tempo="${bpm}"/>`
      : barMeter !== (bars[i - 1].meter ?? meter) ? `<attributes>${timing}</attributes>` : '';
    if (chordLabel) {
      for (const [index, beat] of bar.beats.entries()) {
        if (index > 0 && beat.chord === bar.beats[index - 1].chord) continue;
        const label = chordLabel(beat.chord);
        const offset = index === 0 && beat.time - bar.start < .04 && !bar.pickup
          ? 0 : bar.beats.length === barMeter && !bar.pickup ? index * divisions
            : Math.round((beat.time - bar.start) / (bar.end - bar.start) * barMeter * divisions);
        if (label && label !== '–') body += renderMusicXmlHarmony({
          chordName: beat.chord, displayLabel: label, preserveExactSpelling: true, defaultY: 28, startDivision: offset,
        });
      }
    }
    for (const mark of rhythmForBar(bar, notes, meter, bpm)) {
      const from = mark.tiedFrom && (i > 0 || mark.onset > bar.start);
      const to = mark.tiedTo && (i < bars.length - 1 || mark.end < bar.end);
      const stop = from ? '<tie type="stop"/>' : '';
      const start = to ? '<tie type="start"/>' : '';
      const ties = (from || to) ? `<notations>${from ? '<tied type="stop"/>' : ''}${to ? '<tied type="start"/>' : ''}</notations>` : '';
      // Electric bass is conventionally written one octave above sounding pitch.
      const pitch = mark.note ? notePitch(mark.note.pitch + 12) : '<rest/>';
      body += `<note>${pitch}<duration>${mark.ticks}</duration>${stop}${start}<type>${mark.value}</type>${mark.dotted ? '<dot/>' : ''}${ties}</note>`;
    }
    return `<measure number="${firstNumber + i}"${bar.pickup ? ' implicit="yes"' : ''}>${body}</measure>`;
  }).join('');
  const sync = JSON.stringify({ measureStartAudioTimes: bars.map((bar) => bar.start) });
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><!-- chordmini-sync-data:${sync} -->
<part-list><score-part id="P1"><part-name>Basso elettrico</part-name></score-part></part-list>
<part id="P1">${measures}</part></score-partwise>`;
}
