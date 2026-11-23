import { tunings, type BassAnalysis, type Edit, type MixAnalysis, type Tuning } from './bassScore';

export type LyricLine = { time: number; text: string };
export type BassProject = {
  format: 'studio-basso';
  version: 1;
  title: string;
  sources: { mix: string | null; bass: string | null };
  mix: MixAnalysis;
  bass: BassAnalysis | null;
  edits: Record<number, Edit>;
  lyrics: LyricLine[];
  settings: {
    tuning: Tuning; meter: number; downbeat: number; manualGrid: boolean;
    showDegrees: boolean; view: 'off' | 'tab' | 'staff'; loop: boolean; loopStart: number; loopEnd: number;
    rate: number; zoom: number; mixLevel: number; bassLevel: number; time: number;
  };
};

export const projectMime = 'application/json';
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const between = (n: unknown, min: number, max: number) => finite(n) && n >= min && n <= max;
const integer = (n: unknown, min: number, max: number) => Number.isInteger(n) && between(n, min, max);
const strings = (xs: unknown, len: number) =>
  Array.isArray(xs) && xs.length === len && xs.every((v) => typeof v === 'string' && v.length < 100);
const sourceName = (v: unknown) => v === null || (typeof v === 'string' && v.length < 300 && !/[\\/]/.test(v));

export function parseProject(json: string): BassProject {
  const p = JSON.parse(json) as BassProject;
  const fail = () => { throw new Error('File di progetto non valido o versione non supportata.'); };
  if (!p || p.format !== 'studio-basso' || p.version !== 1 || typeof p.title !== 'string' || p.title.length > 300 ||
      !p.sources || !sourceName(p.sources.mix) || !sourceName(p.sources.bass) || !p.mix || !p.settings) return fail();
  const { mix, bass, settings: s } = p;
  if (!between(mix.duration, 0.01, 86400) || !Array.isArray(mix.beats) || mix.beats.length > 30000 ||
      !mix.beats.every((t, i) => between(t, 0, 86400) && (!i || t > mix.beats[i - 1])) ||
      !strings(mix.chords, mix.beats.length) || !integer(mix.downbeat, 0, 24) ||
      [mix.beatModel, mix.chordModel].some((name) => name !== undefined && (typeof name !== 'string' || name.length > 100)) ||
      (mix.bpm !== null && !between(mix.bpm, 1, 1000)) || (mix.meter !== undefined && !integer(mix.meter, 1, 24))) return fail();
  if (mix.grid) {
    const g = mix.grid;
    if (!Array.isArray(g.beats) || g.beats.length > 30000 || !g.beats.every((t) => t === null || between(t, 0, 86400)) ||
        !strings(g.chords, g.beats.length) || (g.metricSegments !== undefined &&
          (!Array.isArray(g.metricSegments) || !g.metricSegments.every((x) => x &&
            integer(x.startIndex, 0, g.beats.length) && integer(x.endIndex, x.startIndex + 1, g.beats.length) &&
            integer(x.beatsPerMeasure, 1, 24))))) return fail();
  }
  if (bass !== null && (!bass || !between(bass.duration, 0.01, 86400) || !Array.isArray(bass.notes) ||
      bass.notes.length > 100000 || !bass.notes.every((n, i) => n && between(n.onset, 0, bass.duration) &&
      between(n.offset, n.onset, bass.duration + 0.1) && integer(n.pitch, 0, 127) && between(n.confidence, 0, 1) &&
      (!i || n.onset >= bass.notes[i - 1].onset)))) return fail();
  if (!p.edits || typeof p.edits !== 'object' || Array.isArray(p.edits) || !Object.entries(p.edits).every(([id, e]) =>
    /^\d+$/.test(id) && +id < (bass?.notes.length ?? 0) && e && typeof e === 'object' &&
    (e.pitch === undefined || integer(e.pitch, 0, 127)) && (e.hidden === undefined || typeof e.hidden === 'boolean') &&
    (e.offset === undefined || (bass && between(e.offset, bass.notes[+id].onset, bass.duration + 0.1))) &&
    (e.position === undefined || (e.position && integer(e.position.string, 0, 4) && integer(e.position.fret, 0, 24))))) return fail();
  if (!Array.isArray(p.lyrics) || p.lyrics.length > 2000 || !p.lyrics.every((line, i) => line &&
    between(line.time, 0, 86400) && typeof line.text === 'string' && line.text.length <= 1000 &&
    (!i || line.time >= p.lyrics[i - 1].time))) return fail();
  if (!Object.hasOwn(tunings, s.tuning) || !['off', 'tab', 'staff'].includes(s.view) || !integer(s.meter, 1, 24) ||
      !integer(s.downbeat, 0, s.meter - 1) || !integer(s.loopStart, 0, 30000) || !integer(s.loopEnd, s.loopStart, 30000) ||
      !between(s.rate, .25, 2) || !between(s.zoom, 1, 3) || !between(s.mixLevel, 0, 100) ||
      !between(s.bassLevel, 0, 100) || !between(s.time, 0, 86400) ||
      ![s.manualGrid, s.showDegrees, s.loop].every((v) => typeof v === 'boolean')) return fail();
  return p;
}

export function parseLrc(input: string): LyricLine[] {
  const offset = +(input.match(/\[offset:\s*([+-]?\d+)\]/i)?.[1] ?? 0) / 1000;
  const marks = /\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g;
  return input.split(/\r?\n/).flatMap((row) => {
    const text = row.replace(marks, '').replace(/<\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?>/g, '').trim();
    if (!text) return [];
    return [...row.matchAll(marks)].map(([, minutes, seconds, fraction]) => ({
      time: Math.max(0, Math.round(((60 * +minutes + +seconds) + +(fraction ?? '').padEnd(3, '0') / 1000 + offset) * 1000) / 1000),
      text: text.slice(0, 1000),
    }));
  }).sort((a, b) => a.time - b.time).slice(0, 2000);
}

export function safeTitle(title: string) {
  return title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '').slice(0, 110) || 'Studio Basso';
}

export function downloadFile(content: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
