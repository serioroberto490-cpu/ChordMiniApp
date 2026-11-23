'use client';

import { useEffect, useState } from 'react';
import type { PreviewNote } from './bassScore';

export function useBassPreview(notes: PreviewNote[] | null, duration: number) {
  const [result, setResult] = useState<{ input: PreviewNote[]; url?: string; error?: string } | null>(null);
  useEffect(() => {
    if (!notes || duration <= 0) return;
    let url: string | undefined;
    let worker: Worker | undefined;
    let active = true;
    const fail = () => {
      if (active) setResult({ input: notes, error: 'Non riesco a preparare l’audio della TAB in questo browser.' });
    };
    try {
      worker = new Worker(new URL('./bassPreview.worker.ts', import.meta.url));
      worker.onmessage = (event: MessageEvent<{ audio?: ArrayBuffer; error?: string }>) => {
        if (!active) return;
        if (event.data.audio) {
          url = URL.createObjectURL(new Blob([event.data.audio], { type: 'audio/wav' }));
          setResult({ input: notes, url });
        } else setResult({ input: notes, error: event.data.error });
        worker?.terminate();
      };
      worker.onerror = fail;
      worker.postMessage({ notes, duration });
    } catch {
      queueMicrotask(fail);
    }
    return () => { active = false; worker?.terminate(); if (url) URL.revokeObjectURL(url); };
  }, [notes, duration]);
  return result?.input === notes ? result : null;
}
