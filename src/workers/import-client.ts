import type { ParseOptions, ParseResult, SourceKind } from '../ingestion/types';
import type { RowByKind } from '../ingestion/normalize';
/** File text remains in this browser; a dedicated worker prevents parser work blocking UI. */
export function runImport<K extends SourceKind>(
  text: string,
  kind: K,
  options: ParseOptions,
  signal?: AbortSignal,
): Promise<ParseResult<RowByKind[K]>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Import cancelled.'));
      return;
    }
    const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
    const id = crypto.randomUUID();
    let finished = false;
    const close = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      close();
      reject(new Error('Import cancelled. No data was accepted.'));
    };
    const timer = setTimeout(() => {
      close();
      reject(new Error('File processing limit reached. Reduce file size or row count.'));
    }, 15000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent) => {
      if (finished || event.data.id !== id) return;
      close();
      event.data.ok
        ? resolve(event.data.result as ParseResult<RowByKind[K]>)
        : reject(new Error('Import failed. Review your file and mapping.'));
    };
    worker.onerror = () => {
      close();
      reject(new Error('Local file worker unavailable. No data was uploaded.'));
    };
    worker.postMessage({ id, text, kind, options });
  });
}
