'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { chordMappingService } from '@/services/chord-analysis/chordMappingService';
import { loadOsmdConstructor } from '@/components/piano-visualizer/sheet-music-display/osmdLoader';
import { bassMusicXml, type Bar, type PlayedNote } from './bassScore';
import { downloadFile, safeTitle, type LyricLine } from './project';
import { bassMidi } from './bassMidi';
import styles from './workspace.module.css';

interface Props {
  title: string;
  bars: Bar[];
  notes: PlayedNote[];
  hasBass: boolean;
  lyrics: LyricLine[];
  loopStart: number;
  loopEnd: number;
  meter: number;
  bpm: number;
  initialDegrees: boolean;
  displayChord: (chord: string) => string;
  number: (index: number) => number;
  chordAt: (time: number) => string | undefined;
  renderTab: (bar: Bar, degrees: boolean, withChords: boolean) => ReactNode;
  onClose: () => void;
}

function GuitarDiagram({ chord, label }: { chord: string; label: string }) {
  const chordData = chordMappingService.getChordDataSync(chord);
  const position = chordData?.positions[0];
  const preferred = chordMappingService.getPreferredDiagramChordName(chord);
  return <figure className={styles.diagram}>
    <figcaption>{label}</figcaption>
    {position ? <>
      <svg viewBox="0 0 104 111" role="img" aria-label={`Posizione chitarra per ${label}`}>
        {position.baseFret !== 1 && <text x="1" y="31">{position.baseFret}</text>}
        {position.frets.map((fret, i) => {
          const x = 21 + i * 13;
          return <g key={i}>
            <line x1={x} x2={x} y1="19" y2="99" />
            {fret < 0 ? <text x={x} y="14" textAnchor="middle">×</text>
              : fret === 0 ? <circle cx={x} cy="10" r="4" fill="none" />
              : <circle cx={x} cy={9 + fret * 20} r="4.2" fill="currentColor" />}
          </g>;
        })}
        {[0, 1, 2, 3, 4].map((i) =>
          <line key={i} x1="21" x2="86" y1={19 + 20 * i} y2={19 + 20 * i} strokeWidth={i === 0 && position.baseFret === 1 ? 3 : 1} />)}
      </svg>
      {preferred && preferred !== chord && <small>Posizione: {preferred}</small>}
    </> : <small>Posizione non disponibile</small>}
  </figure>;
}

function PrintStaff({ xml, onStatus }: { xml: string; onStatus: (value: 'ready' | 'error') => void }) {
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onStatus);
  useEffect(() => { callback.current = onStatus; }, [onStatus]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let active = true;
    let score: InstanceType<Awaited<ReturnType<typeof loadOsmdConstructor>>> | undefined;
    void (async () => {
      try {
        const Osmd = await loadOsmdConstructor();
        if (!active) return;
        score = new Osmd(element, { autoResize: false, backend: 'svg', drawTitle: false, drawPartNames: false,
          drawPartAbbreviations: false, followCursor: false, drawingParameters: 'default' });
        await score.load(xml);
        if (!active) return;
        score.Zoom = 0.72;
        score.render();
        callback.current('ready');
      } catch {
        if (active) callback.current('error');
      }
    })();
    return () => { active = false; score?.clear(); };
  }, [xml]);
  return <div ref={host} className={styles.printStaff} />;
}

type Scope = 'all' | 'loop' | 'range';
type Layer = 'off' | 'tab' | 'staff' | 'both';
const defaultStart = (base: number, length: number, last: number) => Math.min(length - 1, Math.max(0, last)) + base;
const shortTime = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;

export default function PrintPreview(p: Props) {
  const { displayChord, lyrics, chordAt, notes, meter, bpm, number } = p;
  const [scope, setScope] = useState<Scope>('all');
  const [showChords, setShowChords] = useState(true);
  const [showDiagrams, setShowDiagrams] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showDegrees, setShowDegrees] = useState(p.initialDegrees);
  const [layer, setLayer] = useState<Layer>(p.hasBass ? 'tab' : 'off');
  const tabEnabled = layer === 'tab' || layer === 'both';
  const staffEnabled = layer === 'staff' || layer === 'both';
  const base = p.number(0);
  const [rangeStart, setRangeStart] = useState(base);
  const [rangeEnd, setRangeEnd] = useState(defaultStart(base, p.bars.length, p.bars.length - 1));
  const [rendered, setRendered] = useState<Record<string, 'ready' | 'error'>>({});
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => { modal.current?.showModal(); }, []);
  const first = Math.min(p.bars.length - 1, Math.max(0, scope === 'loop' ? p.loopStart : scope === 'range' ? rangeStart - base : 0));
  const last = Math.min(p.bars.length - 1, Math.max(first, scope === 'loop' ? p.loopEnd
    : scope === 'range' ? rangeEnd - base : p.bars.length - 1));
  const bars = useMemo(() => p.bars.slice(first, last + 1), [p.bars, first, last]);
  const startTime = bars[0]?.start ?? 0;
  const endTime = bars.at(-1)?.end ?? 0;
  const chords = useMemo(() => [...new Set(bars.flatMap((bar) => bar.beats.map((beat) => beat.chord)))]
    .filter((chord) => displayChord(chord) !== '–' && chord), [bars, displayChord]);
  const gridBeats = useMemo(() => bars.flatMap((bar) => bar.beats), [bars]);
  const lyricRows = useMemo(() => lyrics.flatMap((line, i) => {
    const end = lyrics[i + 1]?.time ?? endTime;
    if (line.time >= endTime || end <= startTime) return [];
    const from = Math.max(line.time, startTime);
    const begin = chordAt(from);
    const labels: string[] = begin ? [displayChord(begin)] : [];
    for (const beat of gridBeats) {
      if (beat.time <= from || beat.time >= Math.min(end, endTime)) continue;
      const chord = displayChord(beat.chord);
      if (labels.at(-1) !== chord) labels.push(chord);
    }
    return [{ ...line, chords: labels.join('  ·  ') }];
  }), [lyrics, displayChord, chordAt, startTime, endTime, gridBeats]);
  const staffParts = useMemo(() => staffEnabled ? Array.from({ length: Math.ceil(bars.length / 8) }, (_, i) => {
    const slice = bars.slice(i * 8, (i + 1) * 8);
    const key = `${first}-${last}-${showChords}-${i}`;
    return { key, xml: bassMusicXml(slice, notes, meter, bpm, number(first + i * 8),
      showChords ? displayChord : undefined) };
  }) : [], [staffEnabled, bars, first, last, showChords, notes, meter, bpm, number, displayChord]);
  const pending = staffParts.some(({ key }) => !rendered[key]);
  const staffError = staffParts.some(({ key }) => rendered[key] === 'error');
  const something = showChords || showDiagrams || showLyrics || layer !== 'off';

  function exportXml() {
    const xml = bassMusicXml(bars, p.notes, p.meter, p.bpm, p.number(first), showChords ? p.displayChord : undefined);
    downloadFile(xml, 'application/vnd.recordare.musicxml+xml', `${safeTitle(p.title)}.musicxml`);
  }

  return <dialog ref={modal} onCancel={() => p.onClose()} aria-labelledby="studio-bass-print-title" className={styles.printDialog}>
    <div className={styles.printToolbar}>
      <div className={styles.row}>
        <h2 id="studio-bass-print-title">Anteprima di stampa</h2>
        <button onClick={p.onClose}>Chiudi anteprima</button>
      </div>
      <div className={styles.row}>
        <label>Intervallo <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
          <option value="all">Brano intero</option><option value="loop">Battute del loop</option><option value="range">Scegli battute</option>
        </select></label>
        {scope === 'range' && <>
          <label>Da <input type="number" min={base} max={p.number(p.bars.length - 1)} value={rangeStart}
            onChange={(e) => { const value = e.target.valueAsNumber; if (Number.isFinite(value)) { setRangeStart(value); setRangeEnd(Math.max(value, rangeEnd)); } }} /></label>
          <label>A <input type="number" min={rangeStart} max={p.number(p.bars.length - 1)} value={rangeEnd}
            onChange={(e) => { if (Number.isFinite(e.target.valueAsNumber)) setRangeEnd(e.target.valueAsNumber); }} /></label>
        </>}
        <label><input type="checkbox" checked={showChords} onChange={(e) => setShowChords(e.target.checked)} /> Sigle degli accordi</label>
        <label><input type="checkbox" checked={showDiagrams} onChange={(e) => setShowDiagrams(e.target.checked)} /> Diagrammi chitarra</label>
        <label><input type="checkbox" checked={showLyrics} disabled={!p.lyrics.length}
          onChange={(e) => setShowLyrics(e.target.checked)} /> Testo con accordi</label>
        <label>Basso <select aria-label="Basso da stampare" value={layer} disabled={!p.hasBass} onChange={(e) => setLayer(e.target.value as Layer)}>
          <option value="off">Nessuno</option><option value="tab">TAB ritmica</option><option value="staff">Pentagramma</option>
          <option value="both">TAB e pentagramma</option>
        </select></label>
        {tabEnabled && <label><input type="checkbox" checked={showDegrees} onChange={(e) =>
          setShowDegrees(e.target.checked)} /> Mostra i gradi in stampa</label>}
      </div>
      <div className={styles.row}>
        <button disabled={!something || pending || staffError} onClick={() => window.print()}>Stampa o salva PDF</button>
        {p.hasBass && <button onClick={exportXml}>Scarica MusicXML</button>}
        {p.hasBass && <button onClick={() => downloadFile(bassMidi(bars, p.notes, p.bpm, p.meter),
          'audio/midi', `${safeTitle(p.title)}.mid`)}>Scarica MIDI del basso</button>}
        {pending && <span role="status">Impaginazione pentagramma…</span>}
        {staffError && <span role="alert">Pentagramma non disponibile. Prova a cambiare intervallo o a scegliere la TAB.</span>}
        {!p.lyrics.length && <span>Per stampare il testo, importa prima un file .lrc.</span>}
      </div>
    </div>
    <article id="studio-bass-print" className={styles.paper}>
      <header><h1>{p.title}</h1><p>Battute {p.number(first)}–{p.number(last)} · {p.bpm} BPM</p></header>
      {!something && <p>Seleziona almeno una sezione da stampare.</p>}
      {(tabEnabled || (layer === 'off' && showChords)) && <div className={tabEnabled ? styles.paperTab : styles.paperGrid}>
        {bars.map((bar, i) => <section key={first + i} className={styles.paperMeasure}>
          <h2>{bar.pickup ? 'Intro' : `Battuta ${p.number(first + i)}`}</h2>
          {tabEnabled ? p.renderTab(bar, showDegrees, showChords) :
            <div className={styles.paperChords}>{bar.beats.map(({ chord }, j) => <span key={j}>{p.displayChord(chord)}</span>)}</div>}
        </section>)}
      </div>}
      {tabEnabled && <p className={styles.printLegend}>Contorno: nota target del basso.{showDegrees && ' I numeri sotto indicano i gradi rispetto alla fondamentale.'}</p>}
      {staffEnabled && staffParts.map(({ key, xml }) =>
        <PrintStaff key={key} xml={xml} onStatus={(value) => setRendered((previous) => ({ ...previous, [key]: value }))} />)}
      {showDiagrams && <section className={styles.paperSection}><h2>Diagrammi chitarra</h2>
        <p>Posizioni suggerite, non rilevate dalla registrazione.</p>
        <div className={styles.paperDiagrams}>{chords.map((chord) =>
          <GuitarDiagram key={chord} chord={chord} label={p.displayChord(chord)} />)}</div>
      </section>}
      {showLyrics && <section className={styles.paperSection}><h2>Testo con accordi</h2>
        <p>Accordi in ordine per riga, non allineati alla singola parola.</p>
        {lyricRows.length ? lyricRows.map((line, i) => <div key={i} className={styles.paperLyric}>
          <strong>{shortTime(line.time)} {line.chords && `· ${line.chords}`}</strong><br />{line.text}
        </div>) : <p>Nessuna riga di testo nell’intervallo scelto.</p>}
      </section>}
    </article>
  </dialog>;
}
