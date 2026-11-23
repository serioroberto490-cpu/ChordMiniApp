import { renderBassPreview } from './bassPreviewAudio';
import type { PreviewNote } from './bassScore';

self.onmessage = (event: MessageEvent<{ notes: PreviewNote[]; duration: number }>) => {
  try {
    const audio = renderBassPreview(event.data.notes, event.data.duration);
    self.postMessage({ audio }, { transfer: [audio] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Ascolto della TAB non disponibile.' });
  }
};
