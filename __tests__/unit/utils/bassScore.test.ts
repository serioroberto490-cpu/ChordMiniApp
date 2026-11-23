import { barAtTime, bassMusicXml, fingerNotes, getBars, getChordMiniBars, getPositions, isChordBassTarget, mergeBassNotes,
  mixGains, rhythmForBar, tabLayout, tabPreviewNotes } from '../../../src/components/local-bass/bassScore';
import { renderBassPreview } from '../../../src/components/local-bass/bassPreviewAudio';

const sample = { duration: 5, beats: [0.5, 1, 1.5, 2.05, 2.5, 3, 3.5, 4], chords: ['C', 'C', 'G'], bpm: 120, downbeat: 0 };

describe('Studio Basso', () => {
  it('uses the mix timeline rather than accumulating nominal BPM', () => {
    const bars = getBars(sample, 0, 4);
    expect(bars.map((bar) => bar.start)).toEqual([0, 0.5, 2.5]);
    expect(barAtTime(bars, 2.5)).toBe(2);
    expect(bars[1].beats[3].time).toBe(2.05);
  });

  it('maps sounding notes to the tuning and respects playable overrides', () => {
    expect(getPositions(23, 'standard')).toEqual([]);
    expect(getPositions(23, 'five')).toEqual([{ string: 4, fret: 0 }]);
    const notes = [{ onset: 1.1, offset: 1.5, pitch: 43, confidence: .99 }];
    expect(fingerNotes(notes, { 0: { position: { string: 1, fret: 5 } } }, 'standard')[0].position)
      .toEqual({ string: 1, fret: 5 });
    expect(fingerNotes(notes, { 0: { hidden: true } }, 'standard')).toEqual([]);
  });

  it('generates bass clef and retains actual measure timestamps for playback', () => {
    const bars = getBars(sample, 0, 4);
    const xml = bassMusicXml(bars, fingerNotes([
      { onset: 2.4, offset: 2.8, pitch: 28, confidence: .95 },
    ], {}, 'standard'), 4, 120, 0);
    expect(xml).toContain('<clef><sign>F</sign><line>4</line></clef>');
    expect(xml).toContain('<step>E</step><octave>2</octave>');
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tie type="stop"/>');
    expect(xml).toContain('"measureStartAudioTimes":[0,0.5,2.5]');
  });

  it('widens a dense TAB measure and keeps beat/cursor interpolation monotonic', () => {
    const bar = getBars(sample, 0, 4)[1];
    const notes = fingerNotes(Array.from({ length: 12 }, (_, i) => ({
      onset: 0.5 + i * 0.03, offset: 0.52 + i * 0.03, pitch: 40, confidence: 1,
    })), {}, 'standard');
    const dense = tabLayout(bar, notes, 1);
    expect(dense.width).toBeGreaterThan(tabLayout(bar, [], 1).width);
    expect(dense.at(notes[1].onset) - dense.at(notes[0].onset)).toBeGreaterThanOrEqual(23);
    expect(dense.at(bar.end)).toBe(dense.width);
  });

  it('keeps solo and independent gains, but reserves headroom when summed', () => {
    expect(mixGains(100, 0, true)).toEqual([1, 0]);
    expect(mixGains(0, 100, true)).toEqual([0, 1]);
    expect(mixGains(25, 60, true)).toEqual([.25, .6]);
    expect(mixGains(100, 100, true)).toEqual([.5, .5]);
    expect(mixGains(70, 100, false)).toEqual([.7, 0]);
  });

  it('preserves the ChordMini grid, including padding and local meter changes', () => {
    const bars = getChordMiniBars({ ...sample, grid: {
      beats: [null, .5, 1, 1.5, 2, 2.5, 3],
      chords: ['', 'C', 'C', 'G', 'Am', 'Am', 'Em'],
      metricSegments: [{ startIndex: 0, endIndex: 4, beatsPerMeasure: 4 },
        { startIndex: 4, endIndex: 7, beatsPerMeasure: 3 }],
    } });
    expect(bars.map(({ start, meter }) => [start, meter])).toEqual([[0, 4], [.5, 4], [2, 3]]);
    expect(bars[1].beats.map(({ chord }) => chord)).toEqual(['C', 'C', 'G']);
    expect(bassMusicXml(bars, [], 4, 120, 0)).toContain('<time><beats>3</beats>');
  });

  it('favors playing a nearby fretted unison but does not avoid open notes at any cost', () => {
    const phrase = (pitches: number[]) => pitches.map((pitch, i) => ({
      pitch, onset: i * .25, offset: i * .25 + .22, confidence: 1,
    }));
    expect(fingerNotes(phrase([42, 43, 44]), {}, 'standard').map(({ position }) => position))
      .toEqual([{ string: 1, fret: 4 }, { string: 1, fret: 5 }, { string: 1, fret: 6 }]);
    expect(fingerNotes(phrase([29, 28]), {}, 'standard')[1].position).toEqual({ string: 3, fret: 0 });
    expect(fingerNotes(phrase([42, 43]), { 1: { position: { string: 0, fret: 0 } } }, 'standard')[1].position)
      .toEqual({ string: 0, fret: 0 });
  });

  it('makes the same eighths, sixteenths, rests and ties available to the TAB and staff', () => {
    const bars = getBars(sample, 0, 4);
    const notes = fingerNotes([
      { onset: .5, offset: .75, pitch: 36, confidence: 1 },
      { onset: .875, offset: 1, pitch: 38, confidence: 1 },
      { onset: 2.25, offset: 2.75, pitch: 35, confidence: 1 },
    ], {}, 'standard');
    const marks = rhythmForBar(bars[1], notes, 4, 120);
    expect(marks.slice(0, 3).map((m) => [m.note?.pitch, m.value])).toEqual([
      [36, 'eighth'], [undefined, '16th'], [38, '16th'],
    ]);
    expect(marks.at(-1)?.tiedTo).toBe(true);
    expect(rhythmForBar(bars[2], notes, 4, 120)[0].tiedFrom).toBe(true);
  });

  it('prioritizes the explicit slash bass over the root, at any octave', () => {
    expect(isChordBassTarget('C/E', 36)).toBe(false);
    expect(isChordBassTarget('C/E', 40)).toBe(true);
    expect(isChordBassTarget('C:maj/3', 52)).toBe(true);
    expect(isChordBassTarget('E♭:min', 39)).toBe(true);
    expect(isChordBassTarget('D#:min', 51)).toBe(true);
    expect(isChordBassTarget('N/C', 36)).toBe(false);
  });

  it('merges a suspected attack without losing its time or changing the preceding pitch', () => {
    const raw = [{ onset: .5, offset: .7, pitch: 40, confidence: .9 },
      { onset: .7, offset: .99, pitch: 41, confidence: .8 }];
    const edits = { 0: { pitch: 39 } };
    const result = mergeBassNotes(fingerNotes(raw, edits, 'standard'), edits, 1)!;
    expect(result.id).toBe(0);
    expect(fingerNotes(raw, result.edits, 'standard')).toMatchObject([{ onset: .5, offset: .99, pitch: 39 }]);
    expect(raw[0].offset).toBe(.7);
  });

  it('sounds one attack per tie chain, but preserves intentional repeated pitches', () => {
    const bars = getBars(sample, 0, 4);
    const notes = fingerNotes([
      { onset: 2.25, offset: 2.875, pitch: 36, confidence: 1 },
      { onset: 2.875, offset: 3.125, pitch: 36, confidence: 1 },
    ], {}, 'standard');
    const preview = tabPreviewNotes(bars, notes, 4, 120);
    expect(preview).toHaveLength(2);
    expect(preview[0].offset).toBe(preview[1].onset);
    const wave = renderBassPreview(preview, sample.duration);
    expect(Buffer.from(wave).subarray(0, 4).toString()).toBe('RIFF');
    const signal = new Int16Array(wave, 44);
    expect(signal.slice(0, 22050).every(value => value === 0)).toBe(true);
    expect(signal.some(value => Math.abs(value) > 1000)).toBe(true);
  });
});
