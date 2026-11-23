import { bassMidi } from '../../../src/components/local-bass/bassMidi';
import { chordDegree, getBars } from '../../../src/components/local-bass/bassScore';
import { parseLrc, parseProject, type BassProject } from '../../../src/components/local-bass/project';

const project: BassProject = {
  format: 'studio-basso', version: 1, title: 'Prova',
  sources: { mix: 'mix.mp3', bass: 'bass.wav' },
  mix: { duration: 3, beats: [0, .5, 1, 1.5, 2, 2.5], chords: ['C/E', 'C/E', 'C/E', 'C/E', 'Am', 'Am'],
    bpm: 120, downbeat: 0 },
  bass: { duration: 3, notes: [{ onset: .25, offset: .5, pitch: 40, confidence: .9 }] },
  edits: { 0: { pitch: 40, position: { string: 1, fret: 2 } } },
  lyrics: [{ time: .5, text: 'Testo' }],
  settings: { tuning: 'standard', meter: 4, downbeat: 0, manualGrid: false, showDegrees: true, view: 'tab',
    loop: true, loopStart: 0, loopEnd: 1, rate: .7, zoom: 1.4, mixLevel: 35, bassLevel: 85, time: 1.25 },
};

describe('Studio Basso project and outputs', () => {
  it('round-trips a project including audio names only, edits, lyrics, and preferences', () => {
    expect(parseProject(JSON.stringify(project))).toEqual(project);
    expect(() => parseProject(JSON.stringify({ ...project, version: 2 }))).toThrow();
    expect(() => parseProject(JSON.stringify({ ...project, sources: { ...project.sources, mix: '../mix.mp3' } }))).toThrow();
    expect(() => parseProject(JSON.stringify({ ...project, edits: { 99: { pitch: 38 } } }))).toThrow();
  });

  it('reads standard LRC timestamps, repeated lines, and offset, without treating markup as lyrics', () => {
    expect(parseLrc('[ti:Brano]\n[offset:50]\n[00:01.20][01:02.300]<00:01.200>Prima\n[00:02]Seconda')).toEqual([
      { time: 1.25, text: 'Prima' }, { time: 2.05, text: 'Seconda' }, { time: 62.35, text: 'Prima' },
    ]);
  });

  it('calculates degree from the root, independent of the slash bass and octave', () => {
    expect(chordDegree('C/E', 40)?.label).toBe('3');
    expect(chordDegree('C/E', 48)?.label).toBe('1');
    expect(chordDegree('A:min', 48)?.label).toBe('♭3');
    expect(chordDegree('B:dim', 41)?.label).toBe('♭5');
    expect(chordDegree('N/C', 36)).toBeNull();
  });

  it('exports sounding pitch and clips to the selected bars', () => {
    const bars = getBars(project.mix, 0, 4);
    const notes = project.bass!.notes.map((note, id) => ({ ...note, id }));
    const full = Buffer.from(bassMidi(bars, notes, 120, 4));
    expect(full.subarray(0, 4).toString()).toBe('MThd');
    expect(full.subarray(14, 18).toString()).toBe('MTrk');
    expect(full).toContain(0x90);
    expect(full.includes(Buffer.from([0x90, 40, 90]))).toBe(true);
    expect(Buffer.from(bassMidi(bars.slice(1), notes, 120, 4)).includes(Buffer.from([0x90, 40, 90]))).toBe(false);
  });
});
