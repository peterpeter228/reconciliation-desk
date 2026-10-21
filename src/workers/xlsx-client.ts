import type { XlsxOptions, XlsxInspection } from '../ingestion/xlsx';
import type { ParseResult, SourceKind } from '../ingestion/types';
import type { RowByKind } from '../ingestion/normalize';
function call<T>(
  operation: 'inspect' | 'parse',
  bytes: Uint8Array,
  kind: SourceKind,
  options: Partial<XlsxOptions>,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Workbook processing cancelled.'));
      return;
    }
    const worker = new Worker(new URL('./xlsx.worker.ts', import.meta.url), { type: 'module' });
    const id = crypto.randomUUID();
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      close();
      reject(new Error('Workbook processing cancelled.'));
    };
    const timer = setTimeout(() => {
      close();
      reject(
        new Error('Workbook processing limit reached. Export a smaller values-only workbook.'),
      );
    }, 15000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent) => {
      if (done || event.data.id !== id) return;
      close();
      event.data.ok
        ? resolve(event.data.result as T)
        : reject(new Error(event.data.error || 'Workbook rejected.'));
    };
    worker.onerror = () => {
      close();
      reject(new Error('Local workbook worker unavailable. No data was uploaded.'));
    };
    worker.postMessage({ id, operation, bytes, kind, options });
  });
}
export function runXlsxInspect(
  bytes: Uint8Array,
  fileName?: string,
  signal?: AbortSignal,
): Promise<XlsxInspection> {
  return call('inspect', bytes, 'BANK', { fileName }, signal);
}
export function runXlsxImport<K extends SourceKind>(
  bytes: Uint8Array,
  kind: K,
  options: XlsxOptions,
  signal?: AbortSignal,
): Promise<ParseResult<RowByKind[K]>> {
  return call('parse', bytes, kind, options, signal);
}
