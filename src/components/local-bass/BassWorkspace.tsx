'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { getBassNoteFromInversion } from '@/utils/chordFormatting/inversions';
import {
  barAtTime, bassMusicXml, chordDegree, fingerNotes, getBars, getChordMiniBars, getPositions, isChordBassTarget, mergeBassNotes,
  mixGains, pitchName, rhythmForBar, tabLayout, tabPreviewNotes, tunings, type Bar, type BassAnalysis, type Edit, type MixAnalysis, type RhythmMark,
  type RhythmValue, type Tuning,
} from './bassScore';
import styles from './workspace.module.css';
import { downloadFile, parseLrc, parseProject, projectMime, safeTitle, type BassProject, type LyricLine } from './project';
import { useBassPreview } from './useBassPreview';

const Staff = dynamic(() => import('@/components/piano-visualizer/SheetMusicDisplay'), { ssr: false });
const PrintPreview = dynamic(() => import('./PrintPreview'), { ssr: false });
const api = '/api/local-bass';
const pageSize = 4;
type Kind = 'mix' | 'bass';
type Source = { name: string; url: string; key: string; file?: File };
type View = 'tab' | 'staff' | 'off';
const clock = (time: number) => {
  const tenths = Math.max(0, Math.round(time * 10));
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
};
const mediaUrl = (file: string) => `${api}?${new URLSearchParams({ file })}`;
const displayChord = (chord: string) => {
  if (['N', 'N/C', 'N.C.'].includes(chord)) return '–';
  const [symbol, inversion] = chord.split('/');
  const [root, quality = ''] = symbol.split(':');
  const bass = inversion ? '/' + getBassNoteFromInversion(root, quality, inversion) : '';
  return root + (quality === 'maj' ? '' : quality.replace(/^min/, 'm')) + bass;
};

function localFile(name: string): Source {
  return { name, url: mediaUrl(name), key: name };
}

async function requestAnalysis<T>(source: Source, kind: Kind, signal: AbortSignal): Promise<T> {
  const query = new URLSearchParams({ kind, ...(source.file ? { name: source.name } : { file: source.name }) });
  const response = await fetch(`${api}?${query}`, { method: 'POST', body: source.file, signal });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error ?? `Analisi non disponibile (${response.status}). Avvia l’app dal file Windows.`);
  }
  return response.json();
}

const rhythmLabels: Record<RhythmValue, string> = {
  whole: 'semibreve', half: 'minima', quarter: 'semiminima', eighth: 'croma', '16th': 'semicroma', '32nd': 'biscroma',
};

function RhythmSymbol({ mark, x, y }: { mark: RhythmMark; x: number; y: number }) {
  const { value } = mark;
  const flags = value === 'eighth' ? 1 : value === '16th' ? 2 : value === '32nd' ? 3 : 0;
  return <g transform={`translate(${x} ${y})`} className={styles.rhythm} data-rhythm={value} aria-hidden="true">
    {mark.note ? <>
      {value !== 'whole' && <line y1="0" y2="19" x1="0" x2="0" />}
      {(value === 'whole' || value === 'half') && <ellipse cy="1" rx="4" ry="2.8" transform="rotate(-17)" />}
      {Array.from({ length: flags }, (_, i) =>
        <path key={i} d={`M 0 ${19 - i * 4} q 0 -3 4 -6 q 3 -2 3 -5`} />)}
    </> : value === 'whole' || value === 'half' ? <rect x="-4.5" y={value === 'whole' ? 9 : 6} width="9" height="4" /> :
      value === 'quarter' ? <path d="M -1 2 l 4 5 -4 4 4 5 q -5 -1 -3 4" /> :
        <><path d={`M 3 4 l ${-5 - (flags - 1)} ${11 + (flags - 1) * 3}`} />
          {Array.from({ length: flags }, (_, i) => <ellipse key={i} cx={-2 - i * 1.6} cy={4 + i * 4} rx="2.1" ry="1.6" />)}</>}
    {mark.dotted && <circle cx="9" cy={mark.note ? 3 : 8} r="1.4" />}
  </g>;
}

function TabBar({ bar, marks, tuning, time, chosen, choose, layout, showDegrees, chordAt }: {
  bar: Bar; marks: RhythmMark[]; tuning: Tuning; time: number; chosen: number | null;
  choose?: (id: number) => void; showDegrees: boolean; chordAt: (time: number) => string | undefined;
  layout: ReturnType<typeof tabLayout>;
}) {
  const strings = tunings[tuning].strings.length;
  const { at: x, width } = layout;
  const lastLine = 14 + 16 * (strings - 1);
  const rhythmY = lastLine + 19;
  const height = rhythmY + (showDegrees ? 42 : 28);
  return <svg className={styles.tab} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height }}
    role="group" aria-label="Tablatura del basso">
    {Array.from({ length: strings }, (_, i) =>
      <line key={i} x1="0" x2={width} y1={14 + i * 16} y2={14 + i * 16} className={styles.string} />)}
    <line x1={width - 0.5} x2={width - 0.5} y1="14" y2={lastLine} className={styles.barline} />
    {time >= bar.start && time < bar.end && <line x1={x(time)} x2={x(time)} y1="4" y2={height - 5} className={styles.cursor} />}
    {marks.map((mark, i) => {
      const note = mark.note;
      const left = x(mark.onset);
      if (!note) return <RhythmSymbol key={i} mark={mark} x={left} y={rhythmY} />;
      const next = marks[i + 1];
      const y = note.position ? 14 + note.position.string * 16 : lastLine + 10;
      const selected = chosen === note.id || (time >= mark.onset && time < mark.end);
      const chord = chordAt(mark.onset + 0.0001);
      const target = isChordBassTarget(chord, note.pitch);
      const degree = showDegrees ? chordDegree(chord, note.pitch) : null;
      const label = note.position ? String(note.position.fret) : '×';
      const duration = rhythmLabels[mark.value] + (mark.dotted ? ' puntata' : '');
      const tieEnd = next?.note?.id === note.id ? x(next.onset) - 8 : width - 2;
      const tieStyle = `${styles.tie} ${target ? styles.targetTie : ''}`;
      return <Fragment key={i}>
        {mark.tiedFrom && i === 0 && <path className={tieStyle} d={`M 1 ${y + 3} Q ${left / 2} ${y + 11} ${left - 7} ${y + 5}`} />}
        {mark.tiedTo && tieEnd > left + 8 && <path className={tieStyle}
          d={`M ${left + 8} ${y + 4} Q ${(left + 8 + tieEnd) / 2} ${y + 13} ${tieEnd} ${y + 4}`} />}
        <g className={`${styles.tabNote} ${target ? styles.targetNote : ''} ${selected ? styles.selectedNote : ''}
        ${note.confidence < 0.75 ? styles.uncertain : ''}`} data-bass-target={target ? 'true' : undefined}
          role={choose ? 'button' : undefined} tabIndex={choose ? 0 : undefined}
          aria-label={`${pitchName(note.pitch)}, ${duration}, ${note.position ? `corda ${note.position.string + 1}, tasto ${label}` : 'fuori estensione'}${target ? ', nota target del basso' : ''}${degree ? `, grado ${degree.label}` : ''}`}
        onClick={choose ? () => choose(note.id) : undefined}
        onKeyDown={(event) => {
          if (choose && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); choose(note.id); }
        }}>
        <title>{pitchName(note.pitch)} · {duration} · {clock(mark.onset)}{target ? ' · nota target del basso' : ''}
          {note.confidence < 0.75 ? ' · stima incerta' : ''}</title>
        {choose && <rect x={left - 10} y={y - 9} width="21" height={height - y + 1} fill="transparent" pointerEvents="all" />}
        <rect className={styles.noteBackground} x={left - 8} y={y - 8} width="16" height="16" rx="3" />
        <text x={left} y={y + 4} textAnchor="middle" style={degree && !target ? { fill: degree.color } : undefined}>{label}</text>
        <RhythmSymbol mark={mark} x={left} y={rhythmY} />
        {degree && <text className={styles.degree} data-degree={degree.label} x={left} y={rhythmY + 34} textAnchor="middle"
          style={target ? undefined : { fill: degree.color }}>{degree.label}</text>}
        </g>
      </Fragment>;
    })}
  </svg>;
}

export default function BassWorkspace() {
  const [files, setFiles] = useState<string[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [mix, setMix] = useState<Source | null>(null);
  const [stem, setStem] = useState<Source | null>(null);
  const [mixAnalysis, setMixAnalysis] = useState<MixAnalysis | null>(null);
  const [bassAnalysis, setBassAnalysis] = useState<BassAnalysis | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('tab');
  const [tuning, setTuning] = useState<Tuning>('standard');
  const [meter, setMeter] = useState(4);
  const [downbeat, setDownbeat] = useState(0);
  const [manualGrid, setManualGrid] = useState(false);
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [chosen, setChosen] = useState<number | null>(null);
  const [mixLevel, setMixLevel] = useState(100);
  const [bassLevel, setBassLevel] = useState(0);
  const [bassSource, setBassSource] = useState<'recording' | 'tab'>('recording');
  const [lastMerge, setLastMerge] = useState<{ notes: Record<number, Edit>; id: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showDegrees, setShowDegrees] = useState(false);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [printOpen, setPrintOpen] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [restoreNames, setRestoreNames] = useState<BassProject['sources'] | null>(null);
  const [retainPosition, setRetainPosition] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [rate, setRate] = useState(1);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pinnedPage, setPinnedPage] = useState<number | null>(null);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(3);
  const [loop, setLoop] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const bassAudio = useRef<HTMLAudioElement>(null);
  const tabAudio = useRef<HTMLAudioElement>(null);
  const request = useRef<AbortController | null>(null);
  const opened = useRef(false);
  const urls = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    fetch(api, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Per usare Studio Basso, apri Avvia Studio Basso.cmd.');
      const found: string[] = (await response.json()).files;
      const stems = found.filter((name) => /(?:[_ (.-]|^)(?:bass|basso)(?:[_. ).-]|$)/i.test(name));
      const originals = found.filter((name) => !/(?:[_ (.-]|^)(?:bass|basso|vocals|drums|other)(?:[_. ).-]|$)/i.test(name));
      const original = originals[0];
      const stemForOriginal = original && stems.find((name) => name.toLowerCase().includes(original.replace(/\.[^.]+$/, '').toLowerCase()));
      const bass = stemForOriginal || (originals.length === 1 && stems.length === 1 ? stems[0] : undefined);
      setFiles(found);
      if (!opened.current) {
        if (original) setMix(localFile(original));
        if (bass) setStem(localFile(bass));
      }
      setLibraryReady(true);
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason.message); });
    const activeUrls = urls.current;
    return () => {
      controller.abort();
      request.current?.abort();
      activeUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const storageKey = !restoreNames && mix && stem ? `chordmini-bass-edits-v1:${JSON.stringify([mix.key, stem.key])}` : '';

  async function analyze(kind: Kind) {
    const source = kind === 'mix' ? mix : stem;
    if (!source) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(kind);
    setError('');
    try {
      if (kind === 'mix') {
        const original = await requestAnalysis<MixAnalysis>(source, kind, controller.signal);
        if (controller.signal.aborted) return;
        setMixAnalysis(original);
        setBassAnalysis(null);
        setBassSource('recording');
        setLastMerge(null);
        setMeter(original.meter ?? 4);
        setDownbeat(original.downbeat);
        setManualGrid(false);
        setPinnedPage(null);
        setChosen(null);
        setLoop(false);
        setLoopStart(0);
        setLoopEnd(3);
      } else {
        const bass = await requestAnalysis<BassAnalysis>(source, kind, controller.signal);
        if (controller.signal.aborted) return;
        let recovered: { edits?: Record<number, Edit>; tuning?: Tuning } = {};
        try { if (storageKey) recovered = JSON.parse(localStorage.getItem(storageKey) ?? '{}') ?? {}; } catch { /* optional storage */ }
        setTuning(recovered.tuning ?? 'standard');
        setEdits(recovered.edits ?? {});
        setBassAnalysis(bass);
        setLastMerge(null);
        setChosen(null);
        setView('tab');
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Analisi non riuscita.');
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  useEffect(() => {
    if (libraryReady && mix && !opened.current) {
      opened.current = true;
      void analyze('mix');
    }
    // The startup pair is analyzed once. Later selections are analyzed explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryReady, mix]);

  useEffect(() => {
    if (!bassAnalysis || !storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ edits, tuning })); } catch { /* optional storage */ }
  }, [bassAnalysis, storageKey, edits, tuning]);

  function changeFile(which: Kind, next: Source | null) {
    const previous = which === 'mix' ? mix : stem;
    if (previous?.file) { URL.revokeObjectURL(previous.url); urls.current.delete(previous.url); }
    if (which === 'mix' || busy === 'bass') {
      request.current?.abort();
      setBusy(null);
    }
    opened.current = true;
    if (restoreNames) {
      if (which === 'mix') {
        const at = audio.current?.currentTime || time;
        audio.current?.pause();
        bassAudio.current?.pause();
        tabAudio.current?.pause();
        setRetainPosition(at);
      }
      (which === 'mix' ? setMix : setStem)(next);
      setError('');
      return;
    }
    setBassAnalysis(null);
    setLastMerge(null);
    setBassSource('recording');
    setError('');
    if (which === 'mix') {
      setMixAnalysis(null);
      setLoop(false);
      audio.current?.pause();
      bassAudio.current?.pause();
      tabAudio.current?.pause();
      setPlaying(false);
      setMediaDuration(0);
      setTime(0);
      setLyrics([]);
      setProjectTitle('');
    }
    (which === 'mix' ? setMix : setStem)(next);
  }

  function upload(which: Kind, file?: File) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    changeFile(which, { name: file.name, url, file, key: `${file.name}:${file.size}:${file.lastModified}` });
  }

  const bars = useMemo(() => mixAnalysis
    ? manualGrid ? getBars(mixAnalysis, downbeat, meter) : getChordMiniBars(mixAnalysis) : [],
  [mixAnalysis, manualGrid, downbeat, meter]);
  const notes = useMemo(() => bassAnalysis ? fingerNotes(bassAnalysis.notes, edits, tuning) : [], [bassAnalysis, edits, tuning]);
  const previewInput = useMemo(() => bassAnalysis && mixAnalysis
    ? tabPreviewNotes(bars, notes, meter, mixAnalysis.bpm ?? 120) : null, [bassAnalysis, mixAnalysis, bars, notes, meter]);
  const preview = useBassPreview(previewInput, mixAnalysis?.duration ?? 0);
  const previewUrl = preview?.url;
  const hasActiveBass = bassSource === 'tab' ? Boolean(previewUrl) : Boolean(stem);

  useEffect(() => {
    for (const player of [audio.current, bassAudio.current, tabAudio.current]) {
      if (player) { player.playbackRate = rate; player.preservesPitch = true; }
    }
  }, [rate, mix, stem, previewUrl]);

  useEffect(() => {
    const [original, isolated] = mixGains(mixLevel, bassLevel, hasActiveBass);
    if (audio.current) audio.current.volume = original;
    if (bassAudio.current) bassAudio.current.volume = bassSource === 'recording' ? isolated : 0;
    if (tabAudio.current) tabAudio.current.volume = bassSource === 'tab' ? isolated : 0;
  }, [mixLevel, bassLevel, mix, stem, previewUrl, bassSource, hasActiveBass]);
  const beats = useMemo(() => bars.flatMap((bar) => bar.beats).sort((a, b) => a.time - b.time), [bars]);
  const chordAt = (at: number) => {
    let lo = 0, hi = beats.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (beats[mid].time <= at) lo = mid + 1;
      else hi = mid;
    }
    return beats[lo - 1]?.chord;
  };
  const activeBar = barAtTime(bars, time);
  const lastPage = Math.max(0, Math.ceil(bars.length / pageSize) - 1);
  const page = Math.min(lastPage, pinnedPage ?? Math.floor(activeBar / pageSize));
  const first = page * pageSize;
  const visible = useMemo(() => bars.slice(first, first + pageSize), [bars, first]);
  const showTab = Boolean(bassAnalysis && view === 'tab');
  const tabMeasures = useMemo(() => showTab ? visible.map((bar) => {
    const marks = rhythmForBar(bar, notes, meter, mixAnalysis?.bpm ?? 120);
    return { marks, layout: tabLayout(bar, marks, zoom) };
  }) : [], [showTab, visible, notes, zoom, meter, mixAnalysis?.bpm]);
  const number = (index: number) => index + (bars[0]?.pickup ? 0 : 1);
  const selected = notes.find((note) => note.id === chosen);
  const previousNote = selected && notes[notes.findIndex((note) => note.id === selected.id) - 1];
  const xml = useMemo(() => bassAnalysis && view === 'staff' && visible.length
    ? bassMusicXml(visible, notes, meter, mixAnalysis?.bpm ?? 120, first + (bars[0]?.pickup ? 0 : 1)) : '',
  [bassAnalysis, view, visible, notes, meter, mixAnalysis, first, bars]);
  const [mediaDuration, setMediaDuration] = useState(0);
  const duration = mixAnalysis?.duration ?? mediaDuration;
  const from = bars[Math.min(loopStart, bars.length - 1)];
  const to = bars[Math.min(Math.max(loopStart, loopEnd), bars.length - 1)];

  function seek(where: number) {
    if (!audio.current || !Number.isFinite(audio.current.duration)) return;
    const target = Math.min(audio.current.duration, Math.max(0, where));
    audio.current.currentTime = target;
    for (const player of [bassAudio.current, tabAudio.current]) {
      if (player && Number.isFinite(player.duration)) player.currentTime = Math.min(target, player.duration);
    }
    setTime(target);
  }

  function pauseFollowers() {
    bassAudio.current?.pause();
    tabAudio.current?.pause();
  }

  function startFollowers() {
    const lead = audio.current;
    if (!lead) return;
    for (const follower of [bassAudio.current, tabAudio.current]) {
      if (follower && Number.isFinite(follower.duration) && lead.currentTime < follower.duration && follower.paused) {
        follower.currentTime = lead.currentTime;
        void follower.play().catch(() => {});
      }
    }
  }

  useEffect(() => {
    if (!playing) return;
    const player = audio.current;
    let frame: number;
    let lastCheck = -Infinity;
    function align(now: number, force = false) {
      if (!player || player.paused || player.readyState < 3) return;
      const target = player.currentTime;
      for (const follower of [bassAudio.current, tabAudio.current]) {
        if (!follower || follower.readyState < 1 || !Number.isFinite(follower.duration)) continue;
        if (target >= follower.duration) { follower.pause(); continue; }
        if (force || follower.paused || Math.abs(follower.currentTime - target) > 0.045) {
          follower.currentTime = target;
          if (follower.paused) void follower.play().catch(() => {});
        }
      }
      lastCheck = now;
    }
    const tick = () => {
      if (player && !player.paused) {
        if (loop && from && to && (player.currentTime >= to.end || player.currentTime < from.start - 0.10)) {
          player.currentTime = from.start;
          align(performance.now(), true);
        }
        setTime(player.currentTime);
        if (performance.now() - lastCheck > 250) align(performance.now());
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, loop, from, to, stem, previewUrl]);

  function togglePlayback() {
    const player = audio.current;
    if (!player) return;
    if (!player.paused) { player.pause(); return; }
    startFollowers();
    void player.play().catch(pauseFollowers);
  }

  function switchBassSource(source: 'recording' | 'tab') {
    setBassSource(source);
    if (bassLevel === 0) { setMixLevel(0); setBassLevel(100); }
    if (audio.current && !audio.current.paused) startFollowers();
  }

  function choose(id: number) {
    setChosen(id);
    const note = notes.find((candidate) => candidate.id === id);
    if (note && audio.current?.paused) seek(note.onset);
  }

  function edit(update: Edit) {
    if (chosen !== null) {
      setLastMerge(null);
      setEdits((previous) => ({ ...previous, [chosen]: { ...previous[chosen], ...update } }));
    }
  }

  function mergeSelected() {
    if (chosen === null) return;
    const result = mergeBassNotes(notes, edits, chosen);
    if (!result) return;
    setLastMerge({ notes: edits, id: chosen });
    setEdits(result.edits);
    setChosen(result.id);
    setStatus('Attacco unito alla nota precedente.');
  }

  function saveProject(copy = false) {
    if (!mixAnalysis) return;
    const title = projectTitle || mix?.name.replace(/\.[^.]+$/, '') || 'Studio Basso';
    const project: BassProject = {
      format: 'studio-basso', version: 1, title,
      sources: { mix: mix?.name ?? restoreNames?.mix ?? null, bass: stem?.name ?? restoreNames?.bass ?? null },
      mix: mixAnalysis, bass: bassAnalysis, edits: bassAnalysis ? edits : {}, lyrics,
      settings: { tuning, meter, downbeat, manualGrid, showDegrees, view, loop, loopStart, loopEnd,
        rate, zoom, mixLevel, bassLevel, time },
    };
    downloadFile(JSON.stringify(project, null, 2), projectMime, `${safeTitle(title)}${copy ? ' - copia' : ''}.studiobasso.json`);
    setStatus(copy ? 'Copia scaricata.' : 'Progetto scaricato (senza audio).');
  }

  async function openProject(file: File) {
    try {
      if (file.size > 24_000_000) throw new Error('File di progetto troppo grande.');
      const project = parseProject(await file.text());
      request.current?.abort();
      opened.current = true;
      audio.current?.pause(); pauseFollowers();
      for (const old of [mix, stem]) {
        if (old?.file) { URL.revokeObjectURL(old.url); urls.current.delete(old.url); }
      }
      const { sources, settings: s } = project;
      setBusy(null); setPlaying(false); setMediaDuration(0); setChosen(null); setPinnedPage(null);
      setPrintOpen(false); setError(''); setProjectTitle(project.title); setRestoreNames(sources);
      setMix(sources.mix && files.includes(sources.mix) ? localFile(sources.mix) : null);
      setStem(sources.bass && files.includes(sources.bass) ? localFile(sources.bass) : null);
      setMixAnalysis(project.mix); setBassAnalysis(project.bass); setEdits(project.edits); setLyrics(project.lyrics);
      setBassSource('recording'); setLastMerge(null);
      setTuning(s.tuning); setMeter(s.meter); setDownbeat(s.downbeat); setManualGrid(s.manualGrid);
      setShowDegrees(s.showDegrees); setView(s.view); setLoop(s.loop); setLoopStart(s.loopStart); setLoopEnd(s.loopEnd);
      setRate(s.rate); setZoom(s.zoom); setMixLevel(s.mixLevel); setBassLevel(s.bassLevel);
      const at = Math.min(s.time, project.mix.duration);
      setTime(at); setRetainPosition(at);
      if (audio.current && sources.mix === mix?.name && !mix?.file && Number.isFinite(audio.current.duration)) {
        seek(at);
        setRetainPosition(null);
      }
      setStatus('Progetto aperto senza ripetere l’analisi.');
    } catch (reason) {
      setError(reason instanceof SyntaxError ? 'Il file non contiene un progetto Studio Basso leggibile.'
        : reason instanceof Error ? reason.message : 'Impossibile aprire il progetto.');
    }
  }

  function newProject() {
    if (mixAnalysis && !window.confirm('Aprire un progetto vuoto? Salva prima una copia se vuoi conservare il lavoro.')) return;
    request.current?.abort();
    audio.current?.pause(); pauseFollowers();
    urls.current.forEach((url) => URL.revokeObjectURL(url)); urls.current.clear();
    opened.current = true;
    setMix(null); setStem(null);
    setMixAnalysis(null); setBassAnalysis(null); setEdits({}); setLyrics([]); setChosen(null);
    setRestoreNames(null); setRetainPosition(null); setProjectTitle('');
    setBassSource('recording'); setLastMerge(null);
    setStatus(''); setError(''); setBusy(null); setPrintOpen(false); setLoop(false); setPlaying(false);
    setTime(0); setMediaDuration(0); setShowDegrees(false); setMixLevel(100); setBassLevel(0); setRate(1); setZoom(1);
  }

  return <>
    <div className={styles.shell} id="studio-bass-workspace">
    <header className={styles.header}>
      <div>
        <div className={styles.eyebrow}>ChordMini / laboratorio locale</div>
        <h1>Studio Basso</h1>
        <p>Dal tuo stem alla linea da suonare, battuta per battuta.</p>
        {/* A full navigation switches from the offline layout to the original ChordMini layout. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className={styles.homeLink} href="/">← Torna a ChordMini</a>
      </div>
      <strong className={styles.badge}>● Solo su questo PC</strong>
    </header>

    <section className={`${styles.card} ${styles.row}`} aria-label="Progetto">
      <button disabled={!mixAnalysis} onClick={() => saveProject()}>Salva progetto</button>
      <button disabled={!mixAnalysis} onClick={() => saveProject(true)}>Salva copia</button>
      <label className={styles.fileAction}>Apri progetto
        <input type="file" accept=".json" aria-label="Apri progetto" disabled={!libraryReady}
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void openProject(file); event.target.value = ''; }} />
      </label>
      <button onClick={newProject}>Nuovo progetto</button>
      <button disabled={!mixAnalysis} onClick={() => { audio.current?.pause(); setPrintOpen(true); }}>Stampa / PDF</button>
      <label className={styles.fileAction}>Importa testo .lrc
        <input type="file" accept=".lrc,.txt" aria-label="Importa testo .lrc" disabled={!mixAnalysis}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            try {
              const lines = file.size < 2_000_000 ? parseLrc(await file.text()) : [];
              if (!lines.length) throw new Error('Non ho trovato righe sincronizzate nel file .lrc.');
              setLyrics(lines); setError(''); setStatus(`${lines.length} righe di testo importate.`);
            } catch (reason) { setError(reason instanceof Error ? reason.message : 'Testo non leggibile.'); }
          }} />
      </label>
      {lyrics.length > 0 && <button onClick={() => { setLyrics([]); setStatus('Testo rimosso.'); }}>Rimuovi testo</button>}
      {status && <span className={styles.status} role="status">{status}</span>}
    </section>

    <section className={styles.card} aria-label="Sorgenti audio">
      <div className={styles.sources}>
        {([['mix', 'Brano originale', mix], ['bass', 'Stem di basso', stem]] as const).map(([which, label, item]) =>
          <div key={which} className={styles.source}>
            <label htmlFor={`library-${which}`}>{label}</label>
            <select id={`library-${which}`} value={item?.file ? '' : item?.name ?? ''}
              onChange={(event) => changeFile(which, event.target.value ? localFile(event.target.value) : null)}>
              <option value="">{item?.file ? item.name : 'Scegli dalla cartella Brani…'}</option>
              {files.map((name) => <option key={name}>{name}</option>)}
            </select>
            <label className={styles.upload}>oppure scegli un file <input type="file" accept=".wav,.mp3,.flac,.ogg"
              aria-label={`Sfoglia: ${label}`} onChange={(event) => { upload(which, event.target.files?.[0]); event.target.value = ''; }} /></label>
            {!item && restoreNames?.[which] && <p className={styles.hint}>Ricollega: {restoreNames[which]}</p>}
          </div>
        )}
        <div className={styles.actions}>
          <button className={styles.primary} disabled={!mix || busy !== null || Boolean(restoreNames)} onClick={() => void analyze('mix')}>
            {busy === 'mix' ? 'Analisi ChordMini in corso…' : '1. Analizza il brano con ChordMini'}
          </button>
          <button disabled={!stem || !mixAnalysis || busy !== null || Boolean(restoreNames && bassAnalysis)} onClick={() => void analyze('bass')}>
            {busy === 'bass' ? 'Trascrizione in corso…' : '2. Aggiungi la linea di basso'}
          </button>
        </div>
      </div>
      {restoreNames && <p className={styles.hint}>Ricollegare l’audio non cambia la partitura salvata. Per un altro brano, scegli «Nuovo progetto».</p>}
      {busy && <p className={styles.hint} role="status">{busy === 'mix'
        ? 'ChordMini analizza accordi e pulsazioni sul tuo PC. La prima analisi può richiedere un minuto.'
        : 'Trascrivo soltanto lo stem, senza cambiare accordi o battute.'}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>

    {mix && <section className={`${styles.card} ${styles.transport}`} aria-label="Riproduzione">
      <div className={styles.row}>
        <div className={styles.group} aria-label="Preimpostazioni di ascolto">
          <button aria-pressed={mixLevel === 100 && bassLevel === 0}
            onClick={() => { setMixLevel(100); setBassLevel(0); }}>Solo mix</button>
          <button aria-pressed={mixLevel === 0 && bassLevel === 100} disabled={!hasActiveBass}
            onClick={() => { setMixLevel(0); setBassLevel(100); }}>Solo basso</button>
          <button aria-pressed={mixLevel === 35 && bassLevel === 85} disabled={!hasActiveBass}
            onClick={() => { setMixLevel(35); setBassLevel(85); }}>Basso in evidenza</button>
        </div>
        <label>Velocità <select value={rate} onChange={(event) => setRate(+event.target.value)}>
          {[0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.15].map((n) => <option key={n} value={n}>{Math.round(n * 100)}%</option>)}
        </select></label>
        {bars.length > 0 && <div className={styles.loop}>
          <label><input type="checkbox" checked={loop} onChange={(event) => {
            setLoop(event.target.checked);
            if (event.target.checked && from && to && (time < from.start || time >= to.end)) seek(from.start);
          }} /> Loop</label>
          <select aria-label="Battuta iniziale del loop" value={Math.min(loopStart, bars.length - 1)}
            onChange={(event) => { const value = +event.target.value; setLoopStart(value); setLoopEnd(Math.max(value, loopEnd)); }}>
            {bars.map((_, i) => <option key={i} value={i}>{number(i)}</option>)}
          </select>
          <span>–</span>
          <select aria-label="Battuta finale del loop" value={Math.min(Math.max(loopStart, loopEnd), bars.length - 1)}
            onChange={(event) => setLoopEnd(+event.target.value)}>
            {bars.map((_, i) => i >= Math.min(loopStart, bars.length - 1) ? <option key={i} value={i}>{number(i)}</option> : null)}
          </select>
        </div>}
        <span className={styles.time}>{clock(time)}{duration > 0 ? ` / ${clock(duration)}` : ''}</span>
      </div>
      {bassAnalysis && <div className={`${styles.row} ${styles.comparison}`} aria-label="Confronto A/B del basso" role="group">
        <strong>Confronto A/B</strong>
        <button aria-pressed={bassSource === 'recording'} disabled={!stem}
          onClick={() => switchBassSource('recording')}>A · Basso registrato</button>
        <button aria-pressed={bassSource === 'tab'} disabled={!previewUrl}
          onClick={() => switchBassSource('tab')}>B · Basso trascritto</button>
        {preview?.error ? <span role="status">{preview.error}</span> :
          !previewUrl && <span role="status">Preparo l’audio della TAB…</span>}
      </div>}
      <div className={styles.mixer}>
        <label>Mix originale <output>{mixLevel}%</output>
          <input type="range" min="0" max="100" step="1" aria-label="Livello mix originale" value={mixLevel}
            onChange={(event) => setMixLevel(+event.target.value)} />
        </label>
        <label>{bassSource === 'tab' ? 'Basso trascritto' : 'Stem di basso'} <output>{bassLevel}%</output>
          <input type="range" min="0" max="100" step="1" aria-label="Livello basso" value={bassLevel}
            disabled={!hasActiveBass} onChange={(event) => setBassLevel(+event.target.value)} />
        </label>
      </div>
      <div className={`${styles.row} ${styles.player}`}>
        <button className={styles.primary} onClick={togglePlayback} disabled={duration <= 0}>{playing ? 'Pausa' : 'Riproduci'}</button>
        <input type="range" min="0" max={duration || 1} step=".01" value={Math.min(time, duration)}
          disabled={duration <= 0} aria-label="Posizione nel brano" onChange={(event) => {
            if (loop && from && to && (+event.target.value < from.start || +event.target.value >= to.end)) setLoop(false);
            seek(+event.target.value);
          }} />
      </div>
      <audio ref={audio} src={mix.url} preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => { setPlaying(false); pauseFollowers(); }}
        onPlaying={startFollowers}
        onWaiting={pauseFollowers}
        onEnded={() => {
          if (loop && from && to && audio.current && to.end >= audio.current.duration - 0.1) {
            seek(from.start);
            void audio.current.play().catch(() => {});
          } else { setPlaying(false); pauseFollowers(); }
        }}
        onSeeked={() => { if (audio.current) setTime(audio.current.currentTime); }}
        onLoadedMetadata={() => {
          if (!audio.current) return;
          audio.current.playbackRate = rate;
          audio.current.preservesPitch = true;
          setMediaDuration(audio.current.duration);
          if (retainPosition !== null) {
            seek(retainPosition);
            setRetainPosition(null);
          }
        }} />
      {stem && <audio ref={bassAudio} src={stem.url} preload="auto" data-source="bass-recording"
        onLoadedMetadata={() => {
          if (bassAudio.current) { bassAudio.current.playbackRate = rate; bassAudio.current.preservesPitch = true; }
        }} />}
      {previewUrl && <audio ref={tabAudio} src={previewUrl} preload="auto" data-source="bass-tab"
        onLoadedMetadata={() => {
          if (tabAudio.current) { tabAudio.current.playbackRate = rate; tabAudio.current.preservesPitch = true; }
          if (audio.current && !audio.current.paused) startFollowers();
        }} />}
    </section>}

    {mixAnalysis && <section className={styles.card} aria-label="Partitura e accordi">
      <div className={styles.scoreHeader}>
        <div><h2>Accordi e battute</h2><p>ChordMini · {mixAnalysis.chordModel} + {mixAnalysis.beatModel} · {mixAnalysis.bpm ?? '—'} BPM
          {bassAnalysis ? ` · ${notes.length} note di basso` : ''}</p></div>
        {bassAnalysis && <div className={styles.group} aria-label="Vista del basso">
          {([['off', 'Nascondi'], ['staff', 'Pentagramma'], ['tab', 'TAB']] as const).map(([value, label]) =>
            <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>)}
        </div>}
      </div>
      <div className={styles.row}>
        {bassAnalysis && <label>Accordatura <select value={tuning} onChange={(event) => setTuning(event.target.value as Tuning)}>
          {Object.entries(tunings).map(([value, data]) => <option key={value} value={value}>{data.label}</option>)}
        </select></label>}
        {showTab && <label>Spazio TAB <select value={zoom} onChange={(event) => setZoom(+event.target.value)}>
          <option value="1">Normale</option><option value="1.4">Ampio</option><option value="1.9">Molto ampio</option>
        </select></label>}
        {showTab && <label><input type="checkbox" checked={showDegrees}
          onChange={(event) => setShowDegrees(event.target.checked)} /> Mostra i gradi dell’accordo</label>}
        <label>Griglia <select value={manualGrid ? String(meter) : 'auto'} onChange={(event) => {
          const value = event.target.value;
          setManualGrid(value !== 'auto');
          if (value !== 'auto') { setMeter(+value); setDownbeat(Math.min(+value - 1, downbeat)); }
          setPinnedPage(null);
          setLoop(false);
        }}><option value="auto">ChordMini</option><option value="4">4/4 manuale</option><option value="3">3/4 manuale</option></select></label>
        {manualGrid && <label>Primo accento <select value={downbeat} onChange={(event) => {
          setDownbeat(+event.target.value); setPinnedPage(null); setLoop(false);
        }}>
          {Array.from({ length: meter }, (_, i) => <option key={i} value={i}>Pulsazione {i + 1}</option>)}
        </select></label>}
        <div className={styles.group}>
          <button aria-label="Battute precedenti" disabled={page === 0} onClick={() => setPinnedPage(page - 1)}>←</button>
          <button aria-pressed={pinnedPage === null} onClick={() => setPinnedPage(null)}>Segui audio</button>
          <button aria-label="Battute successive" disabled={page >= lastPage} onClick={() => setPinnedPage(page + 1)}>→</button>
        </div>
      </div>
      {bassAnalysis && Math.abs(mixAnalysis.duration - bassAnalysis.duration) > 0.1 && <p className={styles.hint} role="status">
        Mix e stem hanno durate diverse: per una buona sincronizzazione, esportali dallo stesso punto senza tagliare il silenzio iniziale.
      </p>}
      {bassAnalysis && !bassAnalysis.notes.length && <p className={styles.hint}>Nessuna nota di basso rilevata in questo stem.</p>}
      {!bassAnalysis && <p className={styles.hint}>Griglia pronta. Premi «Aggiungi la linea di basso» per sovrapporre la trascrizione dello stem.</p>}
      {Array.from({ length: Math.ceil(visible.length / (showTab ? 2 : 4)) }, (_, row) => {
        const start = row * (showTab ? 2 : 4);
        const group = visible.slice(start, start + (showTab ? 2 : 4));
        const columns = group.map((_, j) => {
          const width = tabMeasures[start + j]?.layout.width ?? 220;
          return `minmax(${width}px, ${width}fr)`;
        }).join(' ');
        return <div className={styles.barScroll} key={row}>
          <div className={`${styles.bars} ${showTab ? styles.tabSystem : ''}`}
            style={showTab ? { gridTemplateColumns: columns, minWidth: `${zoom * 100}%` } : undefined}>
            {group.map((bar, j) => {
              const i = start + j;
              const tab = tabMeasures[i];
              const go = (where: number) => {
                if (loop && (first + i < loopStart || first + i > loopEnd)) setLoop(false);
                seek(where);
              };
              return <div className={`${styles.bar} ${first + i === activeBar ? styles.activeBar : ''}`} key={first + i}>
                <button className={styles.measure} onClick={() => go(bar.start)}>
                  {bar.pickup ? 'Intro' : `Battuta ${number(first + i)}`} <span>{clock(bar.start)}</span>
                </button>
                <div className={`${styles.chords} ${tab ? styles.timelineChords : ''}`}>
                  {bar.beats.map(({ chord, time: beat }, j) =>
                    <button key={j} onClick={() => go(beat)}
                      style={tab ? { left: `${100 * tab.layout.at(beat) / tab.layout.width}%` } : undefined}
                      aria-label={`Pulsazione ${j + 1}, ${chord}`}>
                      {displayChord(chord)}
                    </button>)}
                </div>
                {tab && <TabBar bar={bar} marks={tab.marks} tuning={tuning} time={time}
                  chosen={chosen} choose={choose} layout={tab.layout} showDegrees={showDegrees} chordAt={chordAt} />}
              </div>;
            })}
          </div>
        </div>;
      })}
      {view === 'staff' && xml && <div className={styles.staff}><Staff musicXml={xml} currentTime={time} totalDuration={duration}
        bpm={mixAnalysis.bpm ?? 120} timeSignature={meter} /></div>}
      {showTab && <p className={styles.hint}><strong className={styles.targetLegend}>Viola: nota target del basso (ad es. Mi in C/E).</strong>{' '}
        {showDegrees && 'I gradi si leggono dalla fondamentale (Mi = 3 su C/E). '}
        Simboli sotto le corde: durate e pause stimate. Sottolineatura gialla: nota incerta. ×: fuori estensione. Clicca un tasto per correggerlo.</p>}
      {showTab && selected && <div className={`${styles.editor} ${styles.row}`}>
        <strong>{pitchName(selected.pitch)} · {clock(selected.onset)}</strong>
        <button onClick={() => edit({ pitch: Math.max(12, selected.pitch - 1), position: undefined })}>− semitono</button>
        <button onClick={() => edit({ pitch: Math.min(100, selected.pitch + 1), position: undefined })}>+ semitono</button>
        <label>Posizione <select value={selected.choice?.string ?? ''} onChange={(event) =>
          edit({ position: event.target.value === '' ? undefined
            : getPositions(selected.pitch, tuning).find(({ string }) => string === +event.target.value) })}>
          <option value="">Automatica</option>
          {getPositions(selected.pitch, tuning).map(({ string, fret }) => <option key={string} value={string}>Corda {string + 1}, tasto {fret}</option>)}
        </select></label>
        <button onClick={() => { edit({ hidden: true }); setChosen(null); }}>Scarta nota</button>
        <button disabled={!previousNote} onClick={mergeSelected}
          title={previousNote ? `Mantiene ${pitchName(previousNote.pitch)} e la prolunga fino alla fine di questa nota` : 'Non c’è una nota precedente'}>
          Unisci alla precedente
        </button>
      </div>}
      {showTab && lastMerge && <button className={styles.reset} onClick={() => {
        setEdits(lastMerge.notes); setChosen(lastMerge.id); setLastMerge(null); setStatus('Unione annullata.');
      }}>Annulla ultima unione</button>}
      {bassAnalysis && Object.keys(edits).length > 0 && <button className={styles.reset} onClick={() => {
        if (window.confirm('Eliminare le correzioni a note e diteggiature? Gli accordi rimangono invariati.')) {
          setEdits({}); setChosen(null); setLastMerge(null); setStatus('Ripristinato il basso automatico.');
        }
      }}>Ripristina il basso automatico</button>}
    </section>}
    </div>
    {printOpen && mixAnalysis && <PrintPreview
      title={projectTitle || mix?.name.replace(/\.[^.]+$/, '') || 'Studio Basso'} bars={bars} notes={notes}
      hasBass={Boolean(bassAnalysis)} lyrics={lyrics} loopStart={loopStart} loopEnd={loopEnd}
      meter={meter} bpm={mixAnalysis.bpm ?? 120} displayChord={displayChord} number={number} chordAt={chordAt}
      onClose={() => setPrintOpen(false)} renderTab={(bar, degrees, withChords) => {
        const marks = rhythmForBar(bar, notes, meter, mixAnalysis.bpm ?? 120);
        const layout = tabLayout(bar, marks, 1);
        return <>
          {withChords && <div className={styles.paperTimedChords}>{bar.beats.map(({ time, chord }, i) =>
            i === 0 || chord !== bar.beats[i - 1].chord ? <span key={i}
              style={{ left: `${100 * layout.at(time) / layout.width}%` }}>{displayChord(chord)}</span> : null)}</div>}
          <TabBar bar={bar} marks={marks} tuning={tuning} time={-1} chosen={null}
            layout={layout} showDegrees={degrees} chordAt={chordAt} />
        </>;
      }} initialDegrees={showDegrees}
    />}
  </>;
}
