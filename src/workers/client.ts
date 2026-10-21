import type { ReconcileInput, ReconcileResult } from '../contracts/engine';
export interface WorkerResult {
  result: ReconcileResult;
  duration_ms: number;
}
/** A fresh worker per run isolates cancelled or stale runs. No main-thread fallback. */
export function runReconciliation(
  input: ReconcileInput,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Run cancelled.'));
      return;
    }
    const worker = new Worker(new URL('./reconcile.worker.ts', import.meta.url), {
      type: 'module',
    });
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
      reject(new Error('Run cancelled. No results were accepted.'));
    };
    // Safety watchdog is NOT the <500ms performance acceptance target.
    const timer = setTimeout(() => {
      close();
      reject(
        new Error('Processing limit reached. Narrow the file scope; the search was not completed.'),
      );
    }, 10_000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent) => {
      if (event.data.id !== id || finished) return;
      close();
      if (event.data.ok)
        resolve({
          result: event.data.result as ReconcileResult,
          duration_ms: event.data.duration_ms,
        });
      else reject(new Error('Reconciliation stopped. Review validation errors.'));
    };
    worker.onerror = () => {
      close();
      reject(new Error('Local worker unavailable. No data was sent to a server.'));
    };
    worker.postMessage({ id, input });
  });
}
