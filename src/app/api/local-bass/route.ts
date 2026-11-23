import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { synchronizeChords } from '@/utils/chordSynchronization';
import { scoreDownbeatAlignment } from '@/utils/chordMeter';
import { getChordGridData } from '@/services/chord-analysis/gridAssembly';
import type { ChordDetectionResult } from '@/types/audioAnalysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const exec = promisify(execFile);
const maximum = 160 * 1024 * 1024;
const folder = path.resolve(process.cwd(), '../Brani');
const cache = path.resolve(process.cwd(), '.cache/local-bass');
const types: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
};
const pending = new Map<string, Promise<string>>();

function allowed(request: Request) {
  const host = request.headers.get('host') ?? '';
  const origin = request.headers.get('origin');
  return process.env.CHORDMINI_LOCAL_BASS === '1'
    && /^127\.0\.0\.1:\d+$/.test(host)
    && (!origin || origin === `http://${host}`)
    && request.headers.get('sec-fetch-site') !== 'cross-site';
}

async function library() {
  try {
    return (await readdir(folder, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && Object.hasOwn(types, path.extname(entry.name).toLowerCase()))
      .map((entry) => entry.name).sort((a, b) => a.localeCompare(b, 'it'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function libraryPath(name: string) {
  if (!(await library()).includes(name)) return null;
  const candidate = path.join(folder, name);
  const resolved = await realpath(candidate);
  return path.dirname(resolved) === await realpath(folder) ? resolved : null;
}

export async function GET(request: Request) {
  if (!allowed(request)) return new Response(null, { status: 403 });
  const name = new URL(request.url).searchParams.get('file');
  if (!name) return Response.json({ files: await library() }, { headers: { 'Cache-Control': 'no-store' } });
  const selected = await libraryPath(name);
  if (!selected) return new Response(null, { status: 404 });
  const { size } = await stat(selected);
  if (!size) return new Response(null, { status: 404 });
  const headers = new Headers({
    'Content-Type': types[path.extname(selected).toLowerCase()],
    'Cache-Control': 'private, no-cache',
    'Accept-Ranges': 'bytes',
  });
  const range = request.headers.get('range');
  let start = 0;
  let end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match?.[1]) {
      start = Number(match[1]);
      if (match[2]) end = Math.min(Number(match[2]), end);
    } else if (match?.[2]) {
      start = Math.max(0, size - Number(match[2]));
    }
    if (!match || (!match[1] && !match[2]) || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  headers.set('Content-Length', String(end - start + 1));
  const body = Readable.toWeb(createReadStream(selected, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers });
}

async function analyze(file: string, key: string, kind: string) {
  const code = await readFile(path.resolve(kind === 'mix' ? 'local-bass/chordmini_mix.py' : 'local-bass/analysis.py'));
  const id = createHash('sha256').update(`${kind}\0${key}\0`).update(code).digest('hex');
  const output = path.join(cache, `${id}.json`);
  try {
    return await readFile(output, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let job = pending.get(id);
  if (!job) {
    const python = path.resolve('.venv-bass', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    job = (async () => {
      const { stdout } = await exec(python, ['-X', 'utf8', path.resolve('local-bass/run_analysis.py'), kind, file], {
        timeout: 300_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
      });
      JSON.parse(stdout);
      await mkdir(cache, { recursive: true });
      await writeFile(output, stdout);
      return stdout;
    })().finally(() => pending.delete(id));
    pending.set(id, job);
  }
  return job;
}

export async function POST(request: Request) {
  if (!allowed(request)) return new Response(null, { status: 403 });
  if (request.headers.has('next-action')) return new Response(null, { status: 404 });
  const query = new URL(request.url).searchParams;
  const kind = query.get('kind');
  if (kind !== 'mix' && kind !== 'bass') {
    return Response.json({ error: 'Scegli il mix o lo stem di basso.' }, { status: 400 });
  }
  const name = query.get('file');
  let temporary: string | undefined;
  try {
    let selected: string;
    let key: string;
    if (name) {
      const source = await libraryPath(name);
      if (!source) return Response.json({ error: 'File non presente in Brani.' }, { status: 404 });
      const { size, mtimeMs } = await stat(source);
      if (size > maximum) return Response.json({ error: 'Il file supera 160 MB.' }, { status: 413 });
      selected = source;
      key = `${source}\0${size}\0${mtimeMs}`;
    } else {
      const extension = path.extname(query.get('name') ?? '').toLowerCase();
      if (!Object.hasOwn(types, extension)) return Response.json({ error: 'Usa WAV, MP3, FLAC o OGG.' }, { status: 400 });
      const declared = Number(request.headers.get('content-length'));
      if (!Number.isSafeInteger(declared) || declared < 1 || declared > maximum) {
        return Response.json({ error: 'File vuoto o superiore a 160 MB.' }, { status: 413 });
      }
      temporary = await mkdtemp(path.join(tmpdir(), 'chordmini-bass-'));
      selected = path.join(temporary, `audio${extension}`);
      if (!request.body) {
        return Response.json({ error: 'File incompleto.' }, { status: 400 });
      }
      let actual = 0;
      const hash = createHash('sha256');
      const reader = request.body.getReader();
      await pipeline(async function* () {
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) return;
            actual += chunk.value.length;
            if (actual > maximum) throw new Error('Audio exceeds the upload size limit');
            hash.update(chunk.value);
            yield chunk.value;
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }, createWriteStream(selected));
      if (actual !== declared) return Response.json({ error: 'File incompleto.' }, { status: 400 });
      key = hash.digest('hex');
    }
    const result = await analyze(selected, key, kind);
    return kind === 'mix' ? Response.json(prepareMix(JSON.parse(result))) :
      new Response(result, { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Studio Basso:', (error as { stderr?: string }).stderr ?? error);
    return Response.json({
      error: kind === 'mix' ? 'L’analisi ChordMini non è riuscita. Verifica che il mix sia leggibile; i dettagli sono nel log di avvio.' :
        'Analisi dello stem non riuscita. Verifica che il file audio sia leggibile o riprova con un WAV.',
    }, { status: 500 });
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

function prepareMix(raw: { duration: number; beats: number[]; bpm: number; segments: ChordDetectionResult[];
  candidates: Record<string, number[]> }) {
  const beats = raw.beats.map((time) => ({ time, strength: 0.8 }));
  const series = synchronizeChords(raw.segments, beats);
  const chords = raw.beats.map(() => 'N/C');
  series.forEach(({ beatIndex, chord }) => { chords[beatIndex] = chord; });
  const meter = scoreDownbeatAlignment(chords, 3).score > scoreDownbeatAlignment(chords, 4).score ? 3 : 4;
  const downbeats = raw.candidates[String(meter)] ?? [];
  const grid = getChordGridData({ beats, chords: raw.segments, synchronizedChords: series, downbeats,
    beatModel: 'madmom', chordModel: 'chord-cnn-lstm', audioDuration: raw.duration,
    beatDetectionResult: { time_signature: meter, bpm: raw.bpm } });
  return { duration: raw.duration, beats: raw.beats, chords, bpm: raw.bpm, meter,
    grid: { beats: grid.beats, chords: grid.chords, metricSegments: grid.metricSegments },
    downbeat: Math.max(0, raw.beats.indexOf(downbeats[0])),
    chordModel: 'Chord-CNN-LSTM', beatModel: 'Madmom' };
}
