/// <reference lib="webworker" />
import { parseSource } from '../ingestion';
import type { ParseOptions, SourceKind } from '../ingestion/types';
self.onmessage = async (
  event: MessageEvent<{ id: string; text: string; kind: SourceKind; options: ParseOptions }>,
) => {
  const { id, text, kind, options } = event.data;
  try {
    self.postMessage({ id, ok: true, result: await parseSource(text, kind, options) });
  } catch {
    self.postMessage({
      id,
      ok: false,
      error: 'Local file import failed. Check the file format and mapping.',
    });
  }
};
